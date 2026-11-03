/** One published revision in an entry's history, as the entry page shows it (spec §5.5; plan M2-16). */
export type RevisionSummary = {
  id: string;
  /** When the worker committed it (the publication time), an ISO timestamp. */
  committedAt: string;
  /** The editor who asked for the publication is the one reading the history. */
  mine: boolean;
  /** The entry's publish pointer names this revision: it is what the site shows now. */
  current: boolean;
};

/** The search parameter the entry page is opened with after a restore, so it can say so. */
export const RESTORED_PARAM = 'restored';
