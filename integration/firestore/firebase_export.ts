/**
 * @license
 * Copyright 2020 Google LLC
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

import { FirebaseApp, initializeApp } from '@firebase/app';
import {
  Firestore,
  FirestoreSettings,
  initializeFirestore
} from '@firebase/firestore';

// This file replaces "packages/firestore/test/integration/util/firebase_export"
// and depends on the minified sources.

let appCount = 0;

export function newTestApp(projectId: string, appName?: string): FirebaseApp {
  if (appName === undefined) {
    appName = 'test-app-' + appCount++;
  }
  return initializeApp(
    {
      apiKey: 'fake-api-key',
      projectId
    },
    appName
  );
}

export function newTestFirestore(
  app: FirebaseApp,
  settings?: FirestoreSettings,
  dbName?: string
): Firestore {
  return initializeFirestore(app, settings || {}, dbName);
}

export * from '@firebase/firestore';

export type PrivateSettings = Record<string, any>;
