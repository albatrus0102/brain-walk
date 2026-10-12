'use strict';
/** Firebase Admin access shared by the AI functions (initializes once; index.js may have done it already). */
const { getApps, initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp, FieldPath } = require('firebase-admin/firestore');

let dbi = null;
function db() {
  if (!getApps().length) initializeApp();
  if (!dbi) dbi = getFirestore();
  return dbi;
}
const fam = (fid) => db().collection('families').doc(fid);
const DAY = 864e5;
const expireIn = (days, nowMs = Date.now()) => Timestamp.fromMillis(nowMs + days * DAY);

module.exports = { db, fam, FieldValue, Timestamp, FieldPath, DAY, expireIn };
