"use strict";

/**
 * lib/roles.js — role predicates.
 *
 * Signal has just two roles, and they are deliberately asymmetric:
 *  - admin       authenticated account holder (Scrum Master / Delivery Manager).
 *  - respondent  anonymous survey taker — never authenticated, never identified.
 *
 * Respondents hold no session and carry no identity; the `respondent` role
 * exists only to name that side of the boundary explicitly.
 */

const ROLES = Object.freeze({
  ADMIN: "admin",
  RESPONDENT: "respondent"
});

const ROLE_VALUES = Object.freeze(Object.values(ROLES));

function isValidRole(role) {
  return ROLE_VALUES.includes(role);
}

function isAdmin(role) {
  return role === ROLES.ADMIN;
}

function isRespondent(role) {
  return role === ROLES.RESPONDENT;
}

module.exports = {
  ROLES,
  ROLE_VALUES,
  isValidRole,
  isAdmin,
  isRespondent
};
