"use strict";

/**
 * v3 — invite links and closed-batch publication.
 *
 * `invites` holds one hashed single-use code per respondent link.
 * `responses.published` marks rows visible in results; the backfill publishes
 * responses of already-closed surveys that met the anonymity floor (3).
 */
function migrateToV3(db) {
  db.exec(`
    CREATE TABLE invites (
      id         TEXT PRIMARY KEY,
      survey_id  TEXT NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
      code_hash  TEXT NOT NULL UNIQUE,
      used       INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX idx_invites_survey ON invites(survey_id);

    ALTER TABLE responses ADD COLUMN published INTEGER NOT NULL DEFAULT 0;

    UPDATE responses SET published = 1
      WHERE survey_id IN (
        SELECT s.id FROM surveys s
        WHERE s.status = 'closed'
          AND (SELECT COUNT(*) FROM responses r WHERE r.survey_id = s.id) >= 3
      );
  `);
}

module.exports = { migrateToV3 };
