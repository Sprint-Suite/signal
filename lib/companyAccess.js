"use strict";

/**
 * lib/companyAccess.js — the cross-company guard for Signal's facilitator API.
 *
 * `team` is a row from the `teams` table (has `company_id`); `company` is
 * `req.user.company` (`{ id, name }` or null) as provided by @suite/auth-client.
 * Returns true only when the team belongs to the session's company.
 */
function teamCompanyAllowed(team, company) {
  return (
    !!company &&
    !!company.id &&
    !!team &&
    team.company_id === company.id
  );
}

module.exports = { teamCompanyAllowed };
