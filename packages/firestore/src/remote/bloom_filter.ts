/**
 * @license
 * Copyright 2022 Google LLC
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
import md5 from 'crypto-js/md5';

interface BitSequence {
  bitmap: string;
  padding: number;
}

export class BloomFilter {
  private readonly bitmap: string;
  private readonly bitSize: number;

  constructor(readonly bits: BitSequence, private readonly hashCount: number) {
    this.bitmap = bits.bitmap;
    this.bitSize = this.bitmap.length * 8 - bits.padding;
  }

  mightContain(document: string): boolean {
    //hash the string using md5
    const hash64 = md5HashStringToHex(document);
    const hash1 = hash64.slice(0, 16);
    const hash2 = hash64.slice(16);

    for (let i = 0; i <= this.hashCount; i++) {
      let combinedHash = parseInt(hash1, 10) + i * parseInt(hash2, 10);
      // Flip all the bits if it's negative (guaranteed positive number)
      if (combinedHash < 0) {
        combinedHash = ~combinedHash;
      }
      if (!this.bitmap[combinedHash % this.bitSize]) {
        return false;
      }
    }
    return true;
  }
}

//temp function for md5 hash
export function md5HashStringToHex(document: string): string {
  return md5(document).toString();
}

export function isBigEndian(): boolean {
  const uInt32 = new Uint32Array([0x12345678]);
  const uInt8 = new Uint8Array(uInt32.buffer);

  if (uInt8[0] === 0x78) {
    return false;
  }
  return true;
}