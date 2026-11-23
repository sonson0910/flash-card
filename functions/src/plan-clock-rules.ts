/**
 * How far before its `startsAt` a Pro plan already counts as active. An operator grant stamps `startsAt` with the
 * clock of the machine that ran it, and a learner's device reads the plan with its own clock, so quota, files,
 * offer and the client meter all accept a start this far ahead of their own time and agree with one another.
 */
export const PRO_START_CLOCK_SKEW_TOLERANCE_MS = 5 * 60_000;
