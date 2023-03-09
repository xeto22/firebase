/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { getMonotonicTimeMs as platformGetMonotonicTimeMs } from '../../util/platform/platform';

import { DocumentSnapshot, QuerySnapshot } from './firebase_export';

const DEFAULT_TIMEOUT_MS = 10000;

export enum TimeoutAction {
  Throw = 'Throw',
  Return = 'Return'
}

export interface SpecializedSingleWaitOptions<T> {
  timeoutMs?: number;
}

export interface SpecializedMultiWaitOptions<T> {
  timeoutMs?: number;
  timeoutAction?: TimeoutAction;
}

export interface SingleWaitOptions<T> {
  timeoutMs?: number;
  eventFilter?: (event: T) => boolean;
}

export interface MultiWaitOptions<T> {
  timeoutMs?: number;
  eventFilter?: (event: T) => boolean;
  timeoutAction?: TimeoutAction;
}

export class EventsAccumulatorTimeoutError extends Error {
  readonly name = 'EventsAccumulatorTimeoutError';
}

/**
 * A helper object that can accumulate an arbitrary amount of events and resolve
 * a promise when expected number has been emitted.
 */
export class EventsAccumulator<T extends DocumentSnapshot | QuerySnapshot> {
  private events: T[] = [];
  private onEvent: (() => void) | null = null;
  private rejectAdditionalEvents = false;

  storeEvent: (event: T) => void = (evt: T) => {
    if (this.rejectAdditionalEvents) {
      throw new Error(
        'Additional event detected after assertNoAdditionalEvents called' +
          JSON.stringify(evt)
      );
    }
    this.events.push(evt);
    this.onEvent?.();
  };

  /** Waits for one or more events to occur. */
  async awaitEvents(
    desiredNumEvents: number,
    options?: MultiWaitOptions<T>
  ): Promise<T[]> {
    if (desiredNumEvents <= 0) {
      throw new Error(`invalid desired number of events: ${desiredNumEvents}`);
    }
    if (this.onEvent !== null) {
      throw new Error('already waiting for events');
    }
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (timeoutMs < 0) {
      throw new Error(`invalid timeout milliseconds: ${timeoutMs}`);
    }

    const startTimeMs = this._getMonotonicTimeMs();
    const eventFilter = options?.eventFilter ?? (() => true);
    const events: T[] = [];
    let lastIndex = 0;

    try {
      while (true) {
        while (lastIndex < this.events.length) {
          const event = this.events[lastIndex++];
          if (eventFilter(event)) {
            events.push(event);
            if (events.length === desiredNumEvents) {
              this.events.splice(0, lastIndex);
              return events;
            }
          }
        }

        const currentTimeoutMs =
          timeoutMs + startTimeMs - this._getMonotonicTimeMs();
        if (currentTimeoutMs <= 0) {
          break;
        }

        await Promise.race([
          new Promise(resolve => {
            this.onEvent = () => resolve(undefined);
          }),
          this._delayMs(currentTimeoutMs)
        ]);
      }
    } finally {
      this.onEvent = null;
    }

    const timeoutAction = options?.timeoutAction ?? TimeoutAction.Throw;
    switch (timeoutAction) {
      case TimeoutAction.Throw: {
        throw new EventsAccumulatorTimeoutError(
          `Timeout (${timeoutMs} ms) ` +
            `waiting for ${desiredNumEvents} events ` +
            `(got ${events.length})`
        );
      }
      case TimeoutAction.Return: {
        this.events.splice(0, lastIndex);
        return events;
      }
      default:
        throw new Error(
          `internal error: unknown timeoutAction: ${timeoutAction}`
        );
    }
  }

  /** Waits for an event to occur. */
  async awaitEvent(options?: SingleWaitOptions<T>): Promise<T> {
    const timeoutAction = TimeoutAction.Throw;
    const tweakedOptions = Object.assign({}, options ?? {}, { timeoutAction });
    const events = await this.awaitEvents(1, tweakedOptions);
    return events[0];
  }

  /** Waits for a latency compensated local snapshot. */
  awaitLocalEvent(options?: SpecializedSingleWaitOptions<T>): Promise<T> {
    const eventFilter = (event: T) => event.metadata.hasPendingWrites;
    const tweakedOptions = Object.assign({}, options ?? {}, { eventFilter });
    return this.awaitEvent(tweakedOptions);
  }

  /** Waits for multiple latency compensated local snapshots. */
  awaitLocalEvents(
    desiredNumEvents: number,
    options?: SpecializedMultiWaitOptions<T>
  ): Promise<T[]> {
    const eventFilter = (event: T) => event.metadata.hasPendingWrites;
    const tweakedOptions = Object.assign({}, options ?? {}, { eventFilter });
    return this.awaitEvents(desiredNumEvents, tweakedOptions);
  }

  /** Waits for a snapshot that has no pending writes */
  awaitRemoteEvent(options?: SpecializedSingleWaitOptions<T>): Promise<T> {
    const eventFilter = (event: T) => !event.metadata.hasPendingWrites;
    const tweakedOptions = Object.assign({}, options ?? {}, { eventFilter });
    return this.awaitEvent(tweakedOptions);
  }

  assertNoAdditionalEvents(): Promise<void> {
    this.rejectAdditionalEvents = true;
    return new Promise((resolve: (val: void) => void, reject) => {
      setTimeout(() => {
        if (this.events.length > 0) {
          reject(
            'Received ' +
              this.events.length +
              ' events: ' +
              JSON.stringify(this.events)
          );
        } else {
          resolve(undefined);
        }
      }, 0);
    });
  }

  allowAdditionalEvents(): void {
    this.rejectAdditionalEvents = false;
  }

  // Provided for unit tests to mock the monotonic clock.
  _getMonotonicTimeMs(): number {
    return platformGetMonotonicTimeMs();
  }

  // Provided for unit tests to mock the "pause" logic.
  _delayMs(delayMs: number): Promise<void> {
    if (delayMs < 0) {
      throw new Error(`invalid delay milliseconds: ${delayMs}`);
    }
    return new Promise(resolve => setTimeout(resolve, delayMs));
  }
}
