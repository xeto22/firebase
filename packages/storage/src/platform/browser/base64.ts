/**
 * @license
 * Copyright 2021 Google LLC
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

import { missingPolyFill } from '../../implementation/error';

/** Converts a Base64 encoded string to a binary string. */
export function decodeBase64(encoded: string): string {
  if (typeof atob === 'undefined') {
    throw missingPolyFill('base-64');
  }
  return atob(encoded);
}

export function decodeUint8Array(data: Uint8Array): string {
  return new TextDecoder().decode(data);
}
