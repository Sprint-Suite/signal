"use strict";

/**
 * lib/publication.js — closed-batch publication of responses.
 *
 * Results read only `published = 1` responses. A batch of pending responses
 * is published on close, and only when it holds at least `min` of them, so
 * no refresh between submissions can isolate one respondent's answers.
 */

function countByPublished(conn, surveyId, published) {
  return conn
    .prepare("SELECT COUNT(*) AS n FROM responses WHERE survey_id = ? AND published = ?")
    .get(surveyId, published).n;
}

const countPublished = (conn, surveyId) => countByPublished(conn, surveyId, 1);
const countPending = (conn, surveyId) => countByPublished(conn, surveyId, 0);

/** Publish every pending response when there are at least `min`; returns how many. */
function publishPending(conn, surveyId, min) {
  return conn.transaction(() => {
    const pending = countPending(conn, surveyId);
    if (pending < min) return 0;
    conn
      .prepare("UPDATE responses SET published = 1 WHERE survey_id = ? AND published = 0")
      .run(surveyId);
    return pending;
  })();
}

module.exports = { publishPending, countPublished, countPending };
