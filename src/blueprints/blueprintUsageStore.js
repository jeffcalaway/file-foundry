'use strict';

const STORAGE_KEY = 'fileFoundry.mostSelectedBlueprints.v1';
const MOST_SELECTED_LIMIT = 3;
const MAX_STORED_BLUEPRINTS = 100;

class BlueprintUsageStore {
  /** @param {{get: Function, update: Function}} workspaceState */
  constructor(workspaceState) {
    this.workspaceState = workspaceState;
  }

  /** Record one blueprint selection with a single bounded workspace-state write. */
  async recordSelection(directoryName) {
    if (typeof directoryName !== 'string' || !directoryName) return;
    const state = this.readState();
    normalizeSequence(state);
    state.sequence += 1;
    const previous = state.records[directoryName];
    state.records[directoryName] = {
      count: Math.min((previous?.count || 0) + 1, Number.MAX_SAFE_INTEGER),
      lastSelected: state.sequence
    };
    pruneRecords(state.records);
    await this.workspaceState.update(STORAGE_KEY, state);
  }

  /**
   * Return at most three active blueprints. Higher counts win membership;
   * newer selections win tied membership, while tied members display oldest
   * to newest so a newly promoted item appears at the bottom of its tie group.
   */
  getMostSelected(blueprints) {
    const records = this.readState().records;
    const candidates = blueprints
      .filter((blueprint) => !blueprint.manifestError && records[blueprint.directoryName])
      .map((blueprint) => ({ blueprint, ...records[blueprint.directoryName] }));
    const members = candidates
      .sort((left, right) => right.count - left.count || right.lastSelected - left.lastSelected ||
        left.blueprint.name.localeCompare(right.blueprint.name))
      .slice(0, MOST_SELECTED_LIMIT);
    return members.sort((left, right) => right.count - left.count || left.lastSelected - right.lastSelected ||
      left.blueprint.name.localeCompare(right.blueprint.name));
  }

  async clear() {
    const count = Object.keys(this.readState().records).length;
    await this.workspaceState.update(STORAGE_KEY, undefined);
    return count;
  }

  readState() {
    return normalizeState(this.workspaceState.get(STORAGE_KEY));
  }
}

function normalizeState(value) {
  const records = {};
  if (value?.version === 1 && value.records && typeof value.records === 'object' && !Array.isArray(value.records)) {
    for (const [key, record] of Object.entries(value.records)) {
      if (!key || !record || typeof record !== 'object') continue;
      const count = safePositiveInteger(record.count);
      const lastSelected = safePositiveInteger(record.lastSelected);
      if (count && lastSelected) records[key] = { count, lastSelected };
    }
  }
  pruneRecords(records);
  const highestSequence = Math.max(0, ...Object.values(records).map((record) => record.lastSelected));
  return {
    version: 1,
    sequence: Math.max(safePositiveInteger(value?.sequence) || 0, highestSequence),
    records
  };
}

function normalizeSequence(state) {
  if (state.sequence < Number.MAX_SAFE_INTEGER) return;
  const ordered = Object.entries(state.records).sort((left, right) =>
    left[1].lastSelected - right[1].lastSelected
  );
  ordered.forEach(([, record], index) => { record.lastSelected = index + 1; });
  state.sequence = ordered.length;
}

function pruneRecords(records) {
  const entries = Object.entries(records);
  if (entries.length <= MAX_STORED_BLUEPRINTS) return;
  const keep = new Set(entries
    .sort((left, right) => right[1].lastSelected - left[1].lastSelected)
    .slice(0, MAX_STORED_BLUEPRINTS)
    .map(([key]) => key));
  for (const key of Object.keys(records)) if (!keep.has(key)) delete records[key];
}

function safePositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

module.exports = {
  BlueprintUsageStore,
  MAX_STORED_BLUEPRINTS,
  MOST_SELECTED_LIMIT,
  STORAGE_KEY,
  normalizeState
};
