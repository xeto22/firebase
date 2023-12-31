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

import * as firestore from '@firebase/firestore-types';
import { expect } from 'chai';

import * as firebaseExport from './util/firebase_export';
import {
  apiDescribe,
  withAlternateTestDb,
  withTestCollection,
  withTestDb
} from './util/helpers';
import { Deferred } from './util/promise';
import { ALT_PROJECT_ID, DEFAULT_PROJECT_ID } from './util/settings';

const FieldPath = firebaseExport.FieldPath;
const FieldValue = firebaseExport.FieldValue;
const newTestFirestore = firebaseExport.newTestFirestore;

// We're using 'as any' to pass invalid values to APIs for testing purposes.
/* eslint-disable @typescript-eslint/no-explicit-any */

interface ValidationIt {
  (
    persistence: boolean,
    message: string,
    testFunction: (db: firestore.FirebaseFirestore) => void | Promise<any>
  ): void;
  skip: (
    persistence: boolean,
    message: string,
    testFunction: (db: firestore.FirebaseFirestore) => void | Promise<any>
  ) => void;
  only: (
    persistence: boolean,
    message: string,
    testFunction: (db: firestore.FirebaseFirestore) => void | Promise<any>
  ) => void;
}

// Since most of our tests are "synchronous" but require a Firestore instance,
// we have a helper wrapper around it() and withTestDb() to optimize for that.
const validationIt: ValidationIt = Object.assign(
  (
    persistence: boolean,
    message: string,
    testFunction: (db: firestore.FirebaseFirestore) => void | Promise<any>
  ) => {
    it(message, () => {
      return withTestDb(persistence, async db => {
        const maybePromise = testFunction(db);
        if (maybePromise) {
          return maybePromise;
        }
      });
    });
  },
  {
    skip(
      persistence: boolean,
      message: string,
      _: (db: firestore.FirebaseFirestore) => void | Promise<any>
    ): void {
      // eslint-disable-next-line no-restricted-properties
      it.skip(message, () => {});
    },
    only(
      persistence: boolean,
      message: string,
      testFunction: (db: firestore.FirebaseFirestore) => void | Promise<any>
    ): void {
      // eslint-disable-next-line no-restricted-properties
      it.only(message, () => {
        return withTestDb(persistence, async db => {
          const maybePromise = testFunction(db);
          if (maybePromise) {
            return maybePromise;
          }
        });
      });
    }
  }
);

/** Class used to verify custom classes can't be used in writes. */
class TestClass {
  constructor(readonly property: string) {}
}

apiDescribe('Validation:', (persistence: boolean) => {
  describe('FirestoreSettings', () => {
    // Enabling persistence counts as a use of the firestore instance, meaning
    // that it will be impossible to verify that a set of settings don't throw,
    // and additionally that some exceptions happen for specific reasons, rather
    // than persistence having already been enabled.
    if (persistence) {
      return;
    }

    validationIt(
      persistence,
      'disallows changing settings after use',
      async db => {
        await db.doc('foo/bar').set({});
        expect(() =>
          db.settings({ host: 'something-else.example.com' })
        ).to.throw(
          'Firestore has already been started and its settings can no ' +
            'longer be changed. You can only modify settings before calling any other ' +
            'methods on a Firestore object.'
        );
      }
    );

    validationIt(persistence, 'enforces minimum cache size', () => {
      const db = newTestFirestore('test-project');
      expect(() => db.settings({ cacheSizeBytes: 1 })).to.throw(
        'cacheSizeBytes must be at least 1048576'
      );
    });

    validationIt(persistence, 'garbage collection can be disabled', () => {
      const db = newTestFirestore('test-project');
      // Verify that this doesn't throw.
      db.settings({ cacheSizeBytes: /* CACHE_SIZE_UNLIMITED= */ -1 });
    });

    validationIt(persistence, 'useEmulator can set host and port', () => {
      const db = newTestFirestore('test-project');
      // Verify that this doesn't throw.
      db.useEmulator('localhost', 9000);
    });

    validationIt(
      persistence,
      'disallows calling useEmulator after use',
      async db => {
        const errorMsg =
          'Firestore has already been started and its settings can no longer be changed.';

        await db.doc('foo/bar').set({});
        expect(() => db.useEmulator('localhost', 9000)).to.throw(errorMsg);
      }
    );

    validationIt(
      persistence,
      'useEmulator can set mockUserToken object',
      () => {
        const db = newTestFirestore('test-project');
        // Verify that this doesn't throw.
        db.useEmulator('localhost', 9000, { mockUserToken: { sub: 'foo' } });
      }
    );

    validationIt(
      persistence,
      'useEmulator can set mockUserToken string',
      () => {
        const db = newTestFirestore('test-project');
        // Verify that this doesn't throw.
        db.useEmulator('localhost', 9000, {
          mockUserToken: 'my-mock-user-token'
        });
      }
    );

    validationIt(
      persistence,
      'throws if sub / user_id is missing in mockUserToken',
      async db => {
        const errorMsg = "mockUserToken must contain 'sub' or 'user_id' field!";

        expect(() =>
          db.useEmulator('localhost', 9000, { mockUserToken: {} as any })
        ).to.throw(errorMsg);
      }
    );
  });

  describe('Firestore', () => {
    (persistence ? validationIt : validationIt.skip)(
      persistence,
      'disallows calling enablePersistence after use',
      db => {
        // Calling `enablePersistence()` itself counts as use, so we should only
        // need this method when persistence is not enabled.
        if (!persistence) {
          db.doc('foo/bar');
        }
        expect(() => db.enablePersistence()).to.throw(
          'Firestore has already been started and persistence can no ' +
            'longer be enabled. You can only enable persistence before ' +
            'calling any other methods on a Firestore object.'
        );
      }
    );

    it("fails transaction if function doesn't return a Promise.", () => {
      return withTestDb(persistence, db => {
        return db
          .runTransaction(() => 5 as any)
          .then(
            x => expect.fail('Transaction should fail'),
            err => {
              expect(err.message).to.equal(
                'Transaction callback must return a Promise'
              );
            }
          );
      });
    });
  });

  describe('Collection paths', () => {
    validationIt(persistence, 'must be non-empty strings', db => {
      const baseDocRef = db.doc('foo/bar');
      expect(() => db.collection('')).to.throw(
        'Function Firestore.collection() cannot be called with an empty path.'
      );
      expect(() => baseDocRef.collection('')).to.throw(
        'Function DocumentReference.collection() cannot be called with an ' +
          'empty path.'
      );
    });

    validationIt(persistence, 'must be odd-length', db => {
      const baseDocRef = db.doc('foo/bar');
      const badAbsolutePaths = ['foo/bar', 'foo/bar/baz/quu'];
      const badRelativePaths = ['/', 'baz/quu'];
      const badPathLengths = [2, 4];

      for (let i = 0; i < badAbsolutePaths.length; i++) {
        const error =
          'Invalid collection reference. Collection references ' +
          'must have an odd number of segments, but ' +
          `${badAbsolutePaths[i]} has ${badPathLengths[i]}`;
        expect(() => db.collection(badAbsolutePaths[i])).to.throw(error);
        expect(() => baseDocRef.collection(badRelativePaths[i])).to.throw(
          error
        );
      }
    });

    validationIt(persistence, 'must not have empty segments', db => {
      // NOTE: leading / trailing slashes are okay.
      db.collection('/foo/');
      db.collection('/foo');
      db.collection('foo/');

      const badPaths = ['foo//bar//baz', '//foo', 'foo//'];
      const collection = db.collection('test-collection');
      const doc = collection.doc('test-document');
      for (const path of badPaths) {
        const reason = `Invalid segment (${path}). Paths must not contain // in them.`;
        expect(() => db.collection(path)).to.throw(reason);
        expect(() => db.doc(path)).to.throw(reason);
        expect(() => collection.doc(path)).to.throw(reason);
        expect(() => doc.collection(path)).to.throw(reason);
      }
    });
  });

  describe('Document paths', () => {
    validationIt(persistence, 'must be strings', db => {
      const baseCollectionRef = db.collection('foo');

      expect(() => db.doc('')).to.throw(
        'Function Firestore.doc() cannot be called with an empty path.'
      );
      expect(() => baseCollectionRef.doc('')).to.throw(
        'Function CollectionReference.doc() cannot be called with an empty ' +
          'path.'
      );
    });

    validationIt(persistence, 'must be even-length', db => {
      const baseCollectionRef = db.collection('foo');
      const badAbsolutePaths = ['foo', 'foo/bar/baz'];
      const badRelativePaths = ['/', 'bar/baz'];
      const badPathLengths = [1, 3];

      for (let i = 0; i < badAbsolutePaths.length; i++) {
        const error =
          'Invalid document reference. Document references ' +
          'must have an even number of segments, but ' +
          `${badAbsolutePaths[i]} has ${badPathLengths[i]}`;
        expect(() => db.doc(badAbsolutePaths[i])).to.throw(error);
        expect(() => baseCollectionRef.doc(badRelativePaths[i])).to.throw(
          error
        );
      }
    });
  });

  validationIt(persistence, 'Merge options are validated', db => {
    const docRef = db.collection('test').doc();

    expect(() => docRef.set({}, { merge: true, mergeFields: [] })).to.throw(
      'Invalid options passed to function DocumentReference.set(): You cannot specify both ' +
        '"merge" and "mergeFields".'
    );
    expect(() => docRef.set({}, { merge: false, mergeFields: [] })).to.throw(
      'Invalid options passed to function DocumentReference.set(): You cannot specify both ' +
        '"merge" and "mergeFields".'
    );
  });

  describe('Writes', () => {
    validationIt(persistence, 'must be objects.', db => {
      // PORTING NOTE: The error for firebase.firestore.FieldValue.delete()
      // is different for minified builds, so omit testing it specifically.
      const badData = [
        42,
        [1],
        new Date(),
        null,
        () => {},
        new TestClass('foo'),
        undefined
      ];
      const errorDescriptions = [
        '42',
        'an array',
        'a custom Date object',
        'null',
        'a function',
        'a custom TestClass object'
      ];
      const promises: Array<Promise<void>> = [];
      for (let i = 0; i < badData.length; i++) {
        const error =
          'Data must be an object, but it was: ' + errorDescriptions[i];
        promises.push(expectWriteToFail(db, badData[i], error));
      }
      return Promise.all(promises);
    });

    validationIt(
      persistence,
      'must not contain custom objects or functions.',
      db => {
        const badData = [
          { foo: new TestClass('foo') },
          { foo: [new TestClass('foo')] },
          { foo: { bar: new TestClass('foo') } },
          { foo: () => {} },
          { foo: [() => {}] },
          { foo: { bar: () => {} } }
        ];
        const errorDescriptions = [
          'Unsupported field value: a custom TestClass object (found in field foo)',
          'Unsupported field value: a custom TestClass object',
          'Unsupported field value: a custom TestClass object (found in field foo.bar)',
          'Unsupported field value: a function (found in field foo)',
          'Unsupported field value: a function',
          'Unsupported field value: a function (found in field foo.bar)'
        ];
        const promises: Array<Promise<void>> = [];
        for (let i = 0; i < badData.length; i++) {
          promises.push(
            expectWriteToFail(db, badData[i], errorDescriptions[i])
          );
        }
        return Promise.all(promises);
      }
    );

    validationIt(
      persistence,
      'must not contain field value transforms in arrays',
      db => {
        return expectWriteToFail(
          db,
          { 'array': [FieldValue.serverTimestamp()] },
          'FieldValue.serverTimestamp() is not currently supported inside arrays'
        );
      }
    );

    validationIt(
      persistence,
      'must not contain directly nested arrays.',
      db => {
        return expectWriteToFail(
          db,
          { 'nested-array': [1, [2]] },
          'Nested arrays are not supported'
        );
      }
    );

    validationIt(persistence, 'may contain indirectly nested arrays.', db => {
      const data = { 'nested-array': [1, { foo: [2] }] };

      const ref = db.collection('foo').doc();
      const ref2 = db.collection('foo').doc();

      return ref
        .set(data)
        .then(() => {
          return ref.firestore.batch().set(ref, data).commit();
        })
        .then(() => {
          return ref.update(data);
        })
        .then(() => {
          return ref.firestore.batch().update(ref, data).commit();
        })
        .then(() => {
          return ref.firestore.runTransaction(async txn => {
            // Note ref2 does not exist at this point so set that and update ref.
            txn.update(ref, data);
            txn.set(ref2, data);
          });
        });
    });

    validationIt(persistence, 'must not contain undefined.', db => {
      // Note: This test uses the default setting for `ignoreUndefinedProperties`.
      return expectWriteToFail(
        db,
        { foo: undefined },
        'Unsupported field value: undefined (found in field foo)'
      );
    });

    validationIt(
      persistence,
      'must not contain references to a different database',
      db => {
        return withAlternateTestDb(persistence, db2 => {
          const ref = db2.doc('baz/quu');
          const data = { foo: ref };
          return expectWriteToFail(
            db,
            data,
            `Document reference is for database ` +
              `${ALT_PROJECT_ID}/(default) but should be for database ` +
              `${DEFAULT_PROJECT_ID}/(default) (found in field ` +
              `foo)`
          );
        });
      }
    );

    validationIt(persistence, 'must not contain reserved field names.', db => {
      return Promise.all([
        expectWriteToFail(
          db,
          { __baz__: 1 },
          'Document fields cannot begin and end with "__" (found in field ' +
            '__baz__)'
        ),
        expectWriteToFail(
          db,
          { foo: { __baz__: 1 } },
          'Document fields cannot begin and end with "__" (found in field ' +
            'foo.__baz__)'
        ),
        expectWriteToFail(
          db,
          { __baz__: { foo: 1 } },
          'Document fields cannot begin and end with "__" (found in field ' +
            '__baz__)'
        ),

        expectUpdateToFail(
          db,
          { 'foo.__baz__': 1 },
          'Document fields cannot begin and end with "__" (found in field ' +
            'foo.__baz__)'
        ),
        expectUpdateToFail(
          db,
          { '__baz__.foo': 1 },
          'Document fields cannot begin and end with "__" (found in field ' +
            '__baz__.foo)'
        )
      ]);
    });

    validationIt(persistence, 'must not contain empty field names.', db => {
      return expectSetToFail(
        db,
        { '': 'foo' },
        'Document fields must not be empty (found in field ``)'
      );
    });

    validationIt(
      persistence,
      'via set() must not contain FieldValue.delete()',
      db => {
        return expectSetToFail(
          db,
          { foo: FieldValue.delete() },
          'FieldValue.delete() cannot be used with set() unless you pass ' +
            '{merge:true} (found in field foo)'
        );
      }
    );

    validationIt(
      persistence,
      'via update() must not contain nested FieldValue.delete()',
      db => {
        return expectUpdateToFail(
          db,
          { foo: { bar: FieldValue.delete() } },
          'FieldValue.delete() can only appear at the top level of your ' +
            'update data (found in field foo.bar)'
        );
      }
    );
  });

  validationIt(
    persistence,
    'Batch writes require correct Document References',
    db => {
      return withAlternateTestDb(persistence, async db2 => {
        const badRef = db2.doc('foo/bar');
        const reason =
          'Provided document reference is from a different Firestore instance.';
        const data = { foo: 1 };
        const batch = db.batch();
        expect(() => batch.set(badRef, data)).to.throw(reason);
        expect(() => batch.update(badRef, data)).to.throw(reason);
        expect(() => batch.delete(badRef)).to.throw(reason);
      });
    }
  );

  validationIt(
    persistence,
    'Transaction writes require correct Document References',
    db => {
      return withAlternateTestDb(persistence, db2 => {
        const badRef = db2.doc('foo/bar');
        const reason =
          'Provided document reference is from a different Firestore instance.';
        const data = { foo: 1 };
        return db.runTransaction(async txn => {
          expect(() => txn.get(badRef)).to.throw(reason);
          expect(() => txn.set(badRef, data)).to.throw(reason);
          expect(() => txn.update(badRef, data)).to.throw(reason);
          expect(() => txn.delete(badRef)).to.throw(reason);
        });
      });
    }
  );

  validationIt(persistence, 'Field paths must not have empty segments', db => {
    const docRef = db.collection('test').doc();
    return docRef
      .set({ test: 1 })
      .then(() => {
        return docRef.get();
      })
      .then(snapshot => {
        const badFieldPaths = ['', 'foo..baz', '.foo', 'foo.'];
        const promises: Array<Promise<void>> = [];
        for (const fieldPath of badFieldPaths) {
          const reason =
            `Invalid field path (${fieldPath}). Paths must not be ` +
            `empty, begin with '.', end with '.', or contain '..'`;
          promises.push(expectFieldPathToFail(snapshot, fieldPath, reason));
        }
        return Promise.all(promises);
      });
  });

  validationIt(
    persistence,
    'Field paths must not have invalid segments',
    db => {
      const docRef = db.collection('test').doc();
      return docRef
        .set({ test: 1 })
        .then(() => {
          return docRef.get();
        })
        .then(snapshot => {
          const badFieldPaths = [
            'foo~bar',
            'foo*bar',
            'foo/bar',
            'foo[1',
            'foo]1',
            'foo[1]'
          ];
          const promises: Array<Promise<void>> = [];
          for (const fieldPath of badFieldPaths) {
            const reason =
              `Invalid field path (${fieldPath}). Paths must not ` +
              `contain '~', '*', '/', '[', or ']'`;
            promises.push(expectFieldPathToFail(snapshot, fieldPath, reason));
          }
          return Promise.all(promises);
        });
    }
  );

  describe('Array transforms', () => {
    validationIt(persistence, 'fail in queries', db => {
      const collection = db.collection('test');
      expect(() =>
        collection.where('test', '==', { test: FieldValue.arrayUnion(1) })
      ).to.throw(
        'Function Query.where() called with invalid data. ' +
          'FieldValue.arrayUnion() can only be used with update() and set() ' +
          '(found in field test)'
      );

      expect(() =>
        collection.where('test', '==', { test: FieldValue.arrayRemove(1) })
      ).to.throw(
        'Function Query.where() called with invalid data. ' +
          'FieldValue.arrayRemove() can only be used with update() and set() ' +
          '(found in field test)'
      );
    });

    validationIt(persistence, 'reject invalid elements', db => {
      const doc = db.collection('test').doc();
      expect(() =>
        doc.set({ x: FieldValue.arrayUnion(1, new TestClass('foo')) })
      ).to.throw(
        'Function FieldValue.arrayUnion() called with invalid data. ' +
          'Unsupported field value: a custom TestClass object'
      );

      expect(() =>
        doc.set({ x: FieldValue.arrayRemove(1, new TestClass('foo')) })
      ).to.throw(
        'Function FieldValue.arrayRemove() called with invalid data. ' +
          'Unsupported field value: a custom TestClass object'
      );

      expect(() => doc.set({ x: FieldValue.arrayRemove(undefined) })).to.throw(
        'Function FieldValue.arrayRemove() called with invalid data. ' +
          'Unsupported field value: undefined'
      );
    });

    validationIt(persistence, 'reject arrays', db => {
      const doc = db.collection('test').doc();
      // This would result in a directly nested array which is not supported.
      expect(() =>
        doc.set({ x: FieldValue.arrayUnion(1, ['nested']) })
      ).to.throw(
        'Function FieldValue.arrayUnion() called with invalid data. ' +
          'Nested arrays are not supported'
      );

      expect(() =>
        doc.set({ x: FieldValue.arrayRemove(1, ['nested']) })
      ).to.throw(
        'Function FieldValue.arrayRemove() called with invalid data. ' +
          'Nested arrays are not supported'
      );
    });
  });

  describe('Numeric transforms', () => {
    validationIt(persistence, 'fail in queries', db => {
      const collection = db.collection('test');
      expect(() =>
        collection.where('test', '==', { test: FieldValue.increment(1) })
      ).to.throw(
        'Function Query.where() called with invalid data. ' +
          'FieldValue.increment() can only be used with update() and set() ' +
          '(found in field test)'
      );
    });
  });

  describe('Queries', () => {
    validationIt(persistence, 'with non-positive limit fail', db => {
      const collection = db.collection('test');
      expect(() => collection.limit(0)).to.throw(
        `Function Query.limit() requires a positive number, but it was: 0.`
      );
      expect(() => collection.limitToLast(-1)).to.throw(
        `Function Query.limitToLast() requires a positive number, but it was: -1.`
      );
    });

    it('cannot be created from documents missing sort values', () => {
      const testDocs = {
        f: { k: 'f', nosort: 1 } // should not show up
      };
      return withTestCollection(persistence, testDocs, coll => {
        const query = coll.orderBy('sort');
        return coll
          .doc('f')
          .get()
          .then(doc => {
            expect(doc.data()).to.deep.equal({ k: 'f', nosort: 1 });
            const reason =
              `Invalid query. You are trying to start or end a ` +
              `query using a document for which the field 'sort' (used as ` +
              `the orderBy) does not exist.`;
            expect(() => query.startAt(doc)).to.throw(reason);
            expect(() => query.startAfter(doc)).to.throw(reason);
            expect(() => query.endBefore(doc)).to.throw(reason);
            expect(() => query.endAt(doc)).to.throw(reason);
          });
      });
    });

    validationIt(
      persistence,
      'cannot be sorted by an uncommitted server timestamp',
      db => {
        return withTestCollection(
          persistence,
          /*docs=*/ {},
          async (collection: firestore.CollectionReference) => {
            await db.disableNetwork();

            const offlineDeferred = new Deferred<void>();
            const onlineDeferred = new Deferred<void>();

            const unsubscribe = collection.onSnapshot(snapshot => {
              // Skip the initial empty snapshot.
              if (snapshot.empty) {
                return;
              }

              expect(snapshot.docs).to.have.lengthOf(1);
              const docSnap: firestore.DocumentSnapshot = snapshot.docs[0];

              if (snapshot.metadata.hasPendingWrites) {
                // Offline snapshot. Since the server timestamp is uncommitted,
                // we shouldn't be able to query by it.
                expect(() =>
                  collection
                    .orderBy('timestamp')
                    .endAt(docSnap)
                    .onSnapshot(() => {})
                ).to.throw('uncommitted server timestamp');
                offlineDeferred.resolve();
              } else {
                // Online snapshot. Since the server timestamp is committed, we
                // should be able to query by it.
                collection
                  .orderBy('timestamp')
                  .endAt(docSnap)
                  .onSnapshot(() => {});
                onlineDeferred.resolve();
              }
            });

            const doc: firestore.DocumentReference = collection.doc();
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            doc.set({ timestamp: FieldValue.serverTimestamp() });
            await offlineDeferred.promise;

            await db.enableNetwork();
            await onlineDeferred.promise;

            unsubscribe();
          }
        );
      }
    );

    validationIt(
      persistence,
      'must not have more components than order by.',
      db => {
        const collection = db.collection('collection');
        const query = collection.orderBy('foo');
        const reason =
          'Too many arguments provided to Query.startAt(). The number of ' +
          'arguments must be less than or equal to the number of orderBy() ' +
          'clauses';
        expect(() => query.startAt(1, 2)).to.throw(reason);
        expect(() => query.orderBy('bar').startAt(1, 2, 3)).to.throw(reason);
      }
    );

    validationIt(
      persistence,
      'order-by-key bounds must be strings without slashes.',
      db => {
        const query = db
          .collection('collection')
          .orderBy(FieldPath.documentId());
        const cgQuery = db
          .collectionGroup('collection')
          .orderBy(FieldPath.documentId());
        expect(() => query.startAt(1)).to.throw(
          'Invalid query. Expected a string for document ID in ' +
            'Query.startAt(), but got a number'
        );
        expect(() => query.startAt('foo/bar')).to.throw(
          'Invalid query. When querying a collection and ordering by ' +
            'documentId(), the value passed to Query.startAt() ' +
            "must be a plain document ID, but 'foo/bar' contains a slash."
        );
        expect(() => cgQuery.startAt('foo')).to.throw(
          'Invalid query. When querying a collection group and ordering by ' +
            'documentId(), the value passed to Query.startAt() ' +
            "must result in a valid document path, but 'foo' is not because " +
            'it contains an odd number of segments.'
        );
      }
    );

    validationIt(persistence, 'with different inequality fields fail', db => {
      const collection = db.collection('test');
      expect(() =>
        collection.where('x', '>=', 32).where('y', '<', 'cat')
      ).to.throw(
        'Invalid query. All where filters with an ' +
          'inequality (<, <=, !=, not-in, >, or >=) must be on the same field.' +
          ` But you have inequality filters on 'x' and 'y'`
      );
    });

    validationIt(persistence, 'with more than one != query fail', db => {
      const collection = db.collection('test');
      expect(() =>
        collection.where('x', '!=', 32).where('x', '!=', 33)
      ).to.throw("Invalid query. You cannot use more than one '!=' filter.");
    });

    validationIt(
      persistence,
      'with != and inequality queries on different fields fail',
      db => {
        const collection = db.collection('test');
        expect(() =>
          collection.where('y', '>', 32).where('x', '!=', 33)
        ).to.throw(
          'Invalid query. All where filters with an ' +
            'inequality (<, <=, !=, not-in, >, or >=) must be on the same field.' +
            ` But you have inequality filters on 'y' and 'x`
        );
      }
    );

    validationIt(
      persistence,
      'with != and inequality queries on different fields fail',
      db => {
        const collection = db.collection('test');
        expect(() =>
          collection.where('y', '>', 32).where('x', 'not-in', [33])
        ).to.throw(
          'Invalid query. All where filters with an ' +
            'inequality (<, <=, !=, not-in, >, or >=) must be on the same field.' +
            ` But you have inequality filters on 'y' and 'x`
        );
      }
    );

    validationIt(
      persistence,
      'with inequality different than first orderBy fail.',
      db => {
        const collection = db.collection('test');
        const reason =
          `Invalid query. You have a where filter with an ` +
          `inequality (<, <=, !=, not-in, >, or >=) on field 'x' and so you must also ` +
          `use 'x' as your first argument to Query.orderBy(), but your first ` +
          `orderBy() is on field 'y' instead.`;
        expect(() => collection.where('x', '>', 32).orderBy('y')).to.throw(
          reason
        );
        expect(() => collection.orderBy('y').where('x', '>', 32)).to.throw(
          reason
        );
        expect(() =>
          collection.where('x', '>', 32).orderBy('y').orderBy('x')
        ).to.throw(reason);
        expect(() =>
          collection.orderBy('y').orderBy('x').where('x', '>', 32)
        ).to.throw(reason);
        expect(() => collection.where('x', '!=', 32).orderBy('y')).to.throw(
          reason
        );
      }
    );

    validationIt(persistence, 'with != and not-in filters fail', db => {
      expect(() =>
        db
          .collection('test')
          .where('foo', 'not-in', [2, 3])
          .where('foo', '!=', 4)
      ).to.throw(
        "Invalid query. You cannot use '!=' filters with 'not-in' filters."
      );

      expect(() =>
        db
          .collection('test')
          .where('foo', '!=', 4)
          .where('foo', 'not-in', [2, 3])
      ).to.throw(
        "Invalid query. You cannot use 'not-in' filters with '!=' filters."
      );
    });

    validationIt(persistence, 'with multiple disjunctive filters fail', db => {
      expect(() =>
        db
          .collection('test')
          .where('foo', 'not-in', [1, 2])
          .where('foo', 'not-in', [2, 3])
      ).to.throw(
        "Invalid query. You cannot use more than one 'not-in' filter."
      );

      expect(() =>
        db
          .collection('test')
          .where('foo', 'not-in', [2, 3])
          .where('foo', 'array-contains-any', [2, 3])
      ).to.throw(
        "Invalid query. You cannot use 'array-contains-any' filters with " +
          "'not-in' filters."
      );

      expect(() =>
        db
          .collection('test')
          .where('foo', 'array-contains-any', [2, 3])
          .where('foo', 'not-in', [2, 3])
      ).to.throw(
        "Invalid query. You cannot use 'not-in' filters with " +
          "'array-contains-any' filters."
      );

      expect(() =>
        db
          .collection('test')
          .where('foo', 'not-in', [2, 3])
          .where('foo', 'in', [2, 3])
      ).to.throw(
        "Invalid query. You cannot use 'in' filters with 'not-in' filters."
      );

      expect(() =>
        db
          .collection('test')
          .where('foo', 'in', [2, 3])
          .where('foo', 'not-in', [2, 3])
      ).to.throw(
        "Invalid query. You cannot use 'not-in' filters with 'in' filters."
      );
    });

    validationIt(
      persistence,
      'can have an IN filter with an array-contains filter.',
      db => {
        expect(() =>
          db
            .collection('test')
            .where('foo', 'array-contains', 1)
            .where('foo', 'in', [2, 3])
        ).not.to.throw();

        expect(() =>
          db
            .collection('test')
            .where('foo', 'in', [2, 3])
            .where('foo', 'array-contains', 1)
        ).not.to.throw();
      }
    );

    validationIt(
      persistence,
      'enforce array requirements for disjunctive filters',
      db => {
        expect(() => db.collection('test').where('foo', 'in', 2)).to.throw(
          "Invalid Query. A non-empty array is required for 'in' filters."
        );

        expect(() =>
          db.collection('test').where('foo', 'array-contains-any', 2)
        ).to.throw(
          'Invalid Query. A non-empty array is required for ' +
            "'array-contains-any' filters."
        );

        expect(() => db.collection('test').where('foo', 'in', [])).to.throw(
          "Invalid Query. A non-empty array is required for 'in' filters."
        );

        expect(() =>
          db.collection('test').where('foo', 'array-contains-any', [])
        ).to.throw(
          'Invalid Query. A non-empty array is required for ' +
            "'array-contains-any' filters."
        );
      }
    );

    validationIt(
      persistence,
      'must not specify starting or ending point after orderBy',
      db => {
        const collection = db.collection('collection');
        const query = collection.orderBy('foo');
        let reason =
          'Invalid query. You must not call startAt() or startAfter() before calling Query.orderBy().';
        expect(() => query.startAt(1).orderBy('bar')).to.throw(reason);
        expect(() => query.startAfter(1).orderBy('bar')).to.throw(reason);

        reason =
          'Invalid query. You must not call endAt() or endBefore() before calling Query.orderBy().';
        expect(() => query.endAt(1).orderBy('bar')).to.throw(reason);
        expect(() => query.endBefore(1).orderBy('bar')).to.throw(reason);
      }
    );

    validationIt(
      persistence,
      'must be non-empty strings or references when filtering by document ID',
      db => {
        const collection = db.collection('test');
        expect(() =>
          collection.where(FieldPath.documentId(), '>=', '')
        ).to.throw(
          'Invalid query. When querying with documentId(), you ' +
            'must provide a valid document ID, but it was an empty string.'
        );
        expect(() =>
          collection.where(FieldPath.documentId(), '>=', 'foo/bar/baz')
        ).to.throw(
          `Invalid query. When querying a collection by documentId(), ` +
            `you must provide a plain document ID, but ` +
            `'foo/bar/baz' contains a '/' character.`
        );
        expect(() =>
          collection.where(FieldPath.documentId(), '>=', 1)
        ).to.throw(
          'Invalid query. When querying with documentId(), you must ' +
            'provide a valid string or a DocumentReference, but it was: 1.'
        );
        expect(() =>
          db.collectionGroup('foo').where(FieldPath.documentId(), '>=', 'foo')
        ).to.throw(
          `Invalid query. When querying a collection group by documentId(), ` +
            `the value provided must result in a valid document path, ` +
            `but 'foo' is not because it has an odd number of segments (1).`
        );

        expect(() =>
          collection.where(FieldPath.documentId(), 'array-contains', 1)
        ).to.throw(
          "Invalid Query. You can't perform 'array-contains' queries on " +
            'documentId().'
        );

        expect(() =>
          collection.where(FieldPath.documentId(), 'array-contains-any', 1)
        ).to.throw(
          "Invalid Query. You can't perform 'array-contains-any' queries on " +
            'documentId().'
        );
      }
    );

    validationIt(
      persistence,
      'using IN and document id must have proper document references in array',
      db => {
        const collection = db.collection('test');

        expect(() =>
          collection.where(FieldPath.documentId(), 'in', [collection.path])
        ).not.to.throw();

        expect(() =>
          collection.where(FieldPath.documentId(), 'in', [''])
        ).to.throw(
          'Invalid query. When querying with documentId(), you ' +
            'must provide a valid document ID, but it was an empty string.'
        );

        expect(() =>
          collection.where(FieldPath.documentId(), 'in', ['foo/bar/baz'])
        ).to.throw(
          `Invalid query. When querying a collection by documentId(), you ` +
            `must provide a plain document ID, but 'foo/bar/baz' contains a ` +
            `'/' character.`
        );

        expect(() =>
          collection.where(FieldPath.documentId(), 'in', [1, 2])
        ).to.throw(
          'Invalid query. When querying with documentId(), you must ' +
            'provide a valid string or a DocumentReference, but it was: 1.'
        );

        expect(() =>
          db.collectionGroup('foo').where(FieldPath.documentId(), 'in', ['foo'])
        ).to.throw(
          `Invalid query. When querying a collection group by documentId(), ` +
            `the value provided must result in a valid document path, ` +
            `but 'foo' is not because it has an odd number of segments (1).`
        );
      }
    );

    validationIt(persistence, 'cannot pass undefined as a field value', db => {
      const collection = db.collection('test');
      expect(() => collection.where('foo', '==', undefined)).to.throw(
        'Function Query.where() called with invalid data. Unsupported field value: undefined'
      );
      expect(() => collection.orderBy('foo').startAt(undefined)).to.throw(
        'Function Query.startAt() called with invalid data. Unsupported field value: undefined'
      );
    });
  });
});

function expectSetToFail(
  db: firestore.FirebaseFirestore,
  data: any,
  reason: string
): Promise<void> {
  return expectWriteToFail(
    db,
    data,
    reason,
    /*includeSets=*/ true,
    /*includeUpdates=*/ false
  );
}

function expectUpdateToFail(
  db: firestore.FirebaseFirestore,
  data: any,
  reason: string
): Promise<void> {
  return expectWriteToFail(
    db,
    data,
    reason,
    /*includeSets=*/ false,
    /*includeUpdates=*/ true
  );
}

/**
 * Performs a write using each set and/or update API and makes sure it fails
 * with the expected reason.
 */
function expectWriteToFail(
  db: firestore.FirebaseFirestore,
  data: any,
  reason: string,
  includeSets?: boolean,
  includeUpdates?: boolean
): Promise<void> {
  if (includeSets === undefined) {
    includeSets = true;
  }
  if (includeUpdates === undefined) {
    includeUpdates = true;
  }

  const docPath = 'foo/bar';
  if (reason.includes('in field')) {
    reason = `${reason.slice(0, -1)} in document ${docPath})`;
  } else {
    reason = `${reason} (found in document ${docPath})`;
  }

  const docRef = db.doc(docPath);
  const error = (fnName: string): string =>
    `Function ${fnName}() called with invalid data. ${reason}`;

  if (includeSets) {
    expect(() => docRef.set(data)).to.throw(error('DocumentReference.set'));
    expect(() => docRef.firestore.batch().set(docRef, data)).to.throw(
      error('WriteBatch.set')
    );
  }

  if (includeUpdates) {
    expect(() => docRef.update(data)).to.throw(
      error('DocumentReference.update')
    );
    expect(() => docRef.firestore.batch().update(docRef, data)).to.throw(
      error('WriteBatch.update')
    );
  }

  return docRef.firestore.runTransaction(async txn => {
    if (includeSets) {
      expect(() => txn.set(docRef, data)).to.throw(error('Transaction.set'));
    }

    if (includeUpdates) {
      expect(() => txn.update(docRef, data)).to.throw(
        error('Transaction.update')
      );
    }
  });
}

/**
 * Tests a field path with all of our APIs that accept field paths and ensures
 * they fail with the specified reason.
 */
function expectFieldPathToFail(
  snapshot: firestore.DocumentSnapshot,
  path: string,
  reason: string
): Promise<void> {
  // Get an arbitrary snapshot we can use for testing.
  return Promise.resolve().then(() => {
    // Snapshot paths.
    expect(() => snapshot.get(path)).to.throw(
      'Function DocumentSnapshot.get() called with invalid data. ' + reason
    );

    const db = snapshot.ref.firestore;

    // Query filter / order fields.
    const coll = db.collection('test-collection');
    // <=, etc omitted for brevity since the code path is trivially
    // shared.
    expect(() => coll.where(path, '==', 1)).to.throw(
      `Function Query.where() called with invalid data. ` + reason
    );
    expect(() => coll.orderBy(path)).to.throw(
      `Function Query.orderBy() called with invalid data. ` + reason
    );

    // Update paths.
    const data = {} as { [field: string]: number };
    data[path] = 1;
    return expectUpdateToFail(db, data, reason);
  });
}
