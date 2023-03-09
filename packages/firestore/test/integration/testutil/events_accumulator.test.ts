/**
 * @license
 * Copyright 2023 Google LLC
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

import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';

import {
  Firestore,
  collection,
  disableNetwork,
  doc,
  DocumentData,
  DocumentSnapshot,
  QuerySnapshot,
  getDocFromCache,
  setDoc
} from '../util/firebase_export';
import { createTestDb } from '../util/helpers';
import {
  EventsAccumulator,
  EventsAccumulatorTimeoutError
} from '../util/events_accumulator';

use(chaiAsPromised);

class FakeGetMonotonicClock {
  readonly startTimeMs: number;
  private currentTimeMs: number;
  private _delayMsCeiling: number | null = null;
  private _delayMsInvocations: number[] = [];

  constructor() {
    this.startTimeMs = 9876000;
    this.currentTimeMs = this.startTimeMs;
  }

  get elapsedTimeMs(): number {
    return this.currentTimeMs - this.startTimeMs;
  }

  get delayMsInvocations(): number[] {
    return Array.from(this._delayMsInvocations);
  }

  set delayMsCeiling(newDelayMsCeiling: number | null) {
    if (newDelayMsCeiling !== null && newDelayMsCeiling <= 0) {
      throw new Error(`invalid newDelayMsCeiling: ${newDelayMsCeiling}`);
    }
    this._delayMsCeiling = newDelayMsCeiling;
  }

  readonly getMonotonicTimeMs: () => number = () => {
    return this.currentTimeMs;
  };

  readonly delayMs: (numMsToDelay: number) => Promise<void> = (
    numMsToDelay: number
  ): Promise<void> => {
    if (numMsToDelay < 0) {
      throw new Error(`invalid numMsToDelay: ${numMsToDelay}`);
    }

    this._delayMsInvocations.push(numMsToDelay);

    if (this._delayMsCeiling !== null && numMsToDelay > this._delayMsCeiling) {
      this.currentTimeMs += this._delayMsCeiling;
    } else {
      this.currentTimeMs += numMsToDelay;
    }

    return Promise.resolve();
  };

  patch<T extends DocumentSnapshot | QuerySnapshot>(
    eventsAccumulator: EventsAccumulator<T>
  ): void {
    eventsAccumulator._getMonotonicTimeMs = this.getMonotonicTimeMs;
    eventsAccumulator._delayMs = this.delayMs;
  }
}

describe.only('EventsAccumulator', () => {
  let fakeMonotonicClock: FakeGetMonotonicClock;
  let fakeMonotonicClockStartTimeMs: number;
  let eventsAccumulator: EventsAccumulator<DocumentSnapshot>;

  beforeEach(() => {
    fakeMonotonicClock = new FakeGetMonotonicClock();
    fakeMonotonicClockStartTimeMs = fakeMonotonicClock.getMonotonicTimeMs();
    eventsAccumulator = new EventsAccumulator<DocumentSnapshot>();
    fakeMonotonicClock.patch(eventsAccumulator);
  });

  let db: Firestore;
  let dbTearDown: (() => void) | null = null;

  beforeEach(async () => {
    const { db: db_, tearDown } = await createTestDb(/*persistence=*/ false);
    db = db_;
    dbTearDown = tearDown;

    // Disable the network to keep these tests as fast as possible.
    // Do not await the call to disableNetwork() because it just wastes time.
    // Awaiting the promise from a future invocation, such as getDoc(), will
    // achieve the same thing since these tasks are enqueued on the same queue.
    disableNetwork(db);
  });

  afterEach(async () => {
    if (dbTearDown) {
      await dbTearDown();
      dbTearDown = null;
    }
  });

  async function createDocumentSnapshot(
    data: DocumentData
  ): Promise<DocumentSnapshot> {
    const collectionRef = collection(db, 'EventsAccumulatorTest');
    const documentRef = doc(collectionRef);
    // Do not await the call to setDoc() because it will block indefinitely if
    // the network is disabled, and we just get the snapshot from cache anyway
    // so don't care if the write operation has made its way to the backend.
    setDoc(documentRef, data);
    return await getDocFromCache(documentRef);
  }

  async function createDocumentSnapshots(
    datas: DocumentData[]
  ): Promise<DocumentSnapshot[]> {
    const snapshots: DocumentSnapshot[] = [];
    for (const data of datas) {
      snapshots.push(await createDocumentSnapshot(data));
    }
    return snapshots;
  }

  it('awaitEvent() should use the correct default timeout', async () => {
    await expect(eventsAccumulator.awaitEvent()).to.eventually.be.rejectedWith(
      EventsAccumulatorTimeoutError
    );
    expect(fakeMonotonicClock.elapsedTimeMs).to.equal(10000);
  });

  it('awaitEvent() should wait in a loop if spuriously woken up', async () => {
    fakeMonotonicClock.delayMsCeiling = 1234;
    await expect(
      eventsAccumulator.awaitEvent({ timeoutMs: 5000 })
    ).to.eventually.be.rejectedWith(EventsAccumulatorTimeoutError);
    expect(fakeMonotonicClock.elapsedTimeMs).to.equal(5000);
    expect(fakeMonotonicClock.delayMsInvocations).to.have.members([
      5000, 3766, 2532, 1298, 64
    ]);
  });

  it('awaitEvent() should return immediately if it has already received an event', async () => {
    const snapshot = await createDocumentSnapshot({ data: 42 });
    eventsAccumulator.storeEvent(snapshot);
    const event = await eventsAccumulator.awaitEvent();
    expect(event).to.equal(snapshot);
    expect(fakeMonotonicClock.elapsedTimeMs).to.equal(0);

    await expect(
      eventsAccumulator.awaitEvent({ timeoutMs: 5000 })
    ).to.eventually.be.rejectedWith(EventsAccumulatorTimeoutError);
    expect(fakeMonotonicClock.elapsedTimeMs).to.equal(5000);
  });

  it('awaitEvent() should return immediately if it has already received multiple events', async () => {
    const snapshot1 = await createDocumentSnapshot({ data: 42 });
    const snapshot2 = await createDocumentSnapshot({ data: 24 });
    eventsAccumulator.storeEvent(snapshot1);
    eventsAccumulator.storeEvent(snapshot2);

    const event1 = await eventsAccumulator.awaitEvent();
    expect(event1).to.equal(snapshot1);
    expect(fakeMonotonicClock.elapsedTimeMs).to.equal(0);

    const event2 = await eventsAccumulator.awaitEvent();
    expect(event2).to.equal(snapshot2);
    expect(fakeMonotonicClock.elapsedTimeMs).to.equal(0);

    await expect(
      eventsAccumulator.awaitEvent({ timeoutMs: 5000 })
    ).to.eventually.be.rejectedWith(EventsAccumulatorTimeoutError);
    expect(fakeMonotonicClock.elapsedTimeMs).to.equal(5000);
  });

  it.only('awaitEvent() should discard events that do not match the filter', async () => {
    const snapshots = await createDocumentSnapshots([
      { key1: 42 },
      { key2: 42 },
      { key3: 42 },
      { key4: 42 },
      { key5: 42 }
    ]);
    snapshots.forEach(eventsAccumulator.storeEvent);
    const event = await eventsAccumulator.awaitEvent({
      eventFilter: snapshot => !!snapshot.get('key3')
    });
    expect(event).to.equal(snapshots[2]);
    expect(fakeMonotonicClock.elapsedTimeMs).to.equal(0);

    const event2 = await eventsAccumulator.awaitEvent();
    expect(event2).to.equal(snapshots[3]);
    const event3 = await eventsAccumulator.awaitEvent();
    expect(event3).to.equal(snapshots[4]);
    await expect(
      eventsAccumulator.awaitEvent({ timeoutMs: 5000 })
    ).to.eventually.be.rejectedWith(EventsAccumulatorTimeoutError);
    expect(fakeMonotonicClock.elapsedTimeMs).to.equal(5000);
  });
});
