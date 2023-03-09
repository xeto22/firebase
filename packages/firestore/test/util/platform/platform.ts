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

/**
 * Implementations provide platform-specific implementations of the given
 * functions.
 *
 * For documentation about each function, see the free function in this module
 * with the same name.
 */
export interface Platform {
  getMonotonicTimeMs(): number;
}

let gPlatform: Platform | null = null;

/**
 * Sets the platform instance for the current platform.
 *
 * This function must be called exactly once before any other function in this
 * module. Invoking this method more than once will throw an exception.Invoking
 * any other function in this module _before_ invoking this function will also
 * throw an exception.
 */
export function setPlatform(platform: Platform): void {
  if (gPlatform !== null) {
    throw new Error('setPlatform() has already been invoked');
  }
  gPlatform = platform;
}

/**
 * Gets the "platform" object set by `setPlatform()`, or throws an exception if
 * `setPlatform()` has never been invoked.
 */
function getPlatform(): Platform {
  if (gPlatform === null) {
    throw new Error('setPlatform() has not yet been invoked');
  }
  return gPlatform;
}

/**
 * Returns the current time of a monotonic clock.
 *
 * The absolute value of the returned number is not meaningful; however,
 * comparing it with previously-returned values within the same process yields
 * the amount of time elapsed between those two invocations. The returned value
 * is not affected by things like time zone changes or daylight savings time
 * changes, which would affect the apparent "elapsed time" if wall clock time
 * were used. Therefore, the returned values are primarily used for measuring
 * elapsed time, such as a timeout when waiting for an event to occur.
 *
 * @return the current time of a monotonic clock, in milliseconds.
 */
export function getMonotonicTimeMs(): number {
  return getPlatform().getMonotonicTimeMs();
}
