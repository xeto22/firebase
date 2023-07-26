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

import { testIndexedDbPersistence } from './persistence_test_helpers';
import { User } from '../../../src/auth/user';
import { QueryEngine } from '../../../src/local/query_engine';
import {LocalDocumentsView} from "../../../src/local/local_documents_view";
import {
  PersistenceTransaction
} from "../../../src/local/persistence_transaction";
import {Query} from "../../../src/core/query";
import {IndexOffset} from "../../../src/model/field_index";
import {PersistencePromise} from "../../../src/local/persistence_promise";
import {DocumentMap} from "../../../src/model/collections";
import {Persistence} from "../../../src/local/persistence";

// This code is ported from
// https://github.com/firebase/firebase-android-sdk/pull/5064
describe('AutoIndexExperiment', async () => {
  let capturedIndexOffsets: IndexOffset[] = [];

  class AutoIndexExperimentLocalDocumentsView extends LocalDocumentsView {
    getDocumentsMatchingQuery(
      transaction: PersistenceTransaction,
      query: Query,
      offset: IndexOffset
    ): PersistencePromise<DocumentMap> {
      capturedIndexOffsets.push(offset);
      return super.getDocumentsMatchingQuery(transaction, query, offset);
    }
  }

  let persistence: Persistence;

  beforeEach(async () => {
    capturedIndexOffsets = [];

    persistence = await testIndexedDbPersistence();

    const indexManager = persistence.getIndexManager(User.UNAUTHENTICATED);
    const mutationQueue = persistence.getMutationQueue(
      User.UNAUTHENTICATED,
      indexManager
    );
    const documentOverlayCache = persistence.getDocumentOverlayCache(
      User.UNAUTHENTICATED
    );
    const remoteDocumentCache = persistence.getRemoteDocumentCache();
    const queryEngine = new QueryEngine();

    remoteDocumentCache.setIndexManager(indexManager);

    const localDocuments = new AutoIndexExperimentLocalDocumentsView(remoteDocumentCache, mutationQueue, documentOverlayCache, indexManager);

    queryEngine.initialize(localDocuments, indexManager);
  });

  it('combines indexed with non indexed results', async () => {});
});
