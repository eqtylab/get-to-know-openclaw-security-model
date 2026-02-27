<script setup lang="ts">
import { ref, computed } from 'vue'
import { useChecklistState, type ControlStatus } from '../composables/useChecklistState'
import type { ChecklistControl } from '../checklist-data'

const {
  controls,
  profiles,
  getControlState,
  setControlStatus,
  setControlNotes,
  applyProfile,
  resetAll,
  exportState,
  stats,
  categoryStats,
  state,
  isDemo,
} = useChecklistState()

const activeCategory = ref<string | null>(null)
const severityFilter = ref<string>('all')
const statusFilter = ref<string>('all')
const showResetConfirm = ref(false)
const showProfileConfirm = ref<string | null>(null)
const profileAppliedFlash = ref(false)
const expandedControl = ref<string | null>(null)
const copiedId = ref<string | null>(null)

const filteredControls = computed(() => {
  let result = controls as ChecklistControl[]

  if (activeCategory.value) {
    result = result.filter(c => c.category === activeCategory.value)
  }

  if (severityFilter.value !== 'all') {
    result = result.filter(c => c.severity === severityFilter.value)
  }

  if (statusFilter.value !== 'all') {
    result = result.filter(c => getControlState(c.id).status === statusFilter.value)
  }

  return result
})

function handleProfileChange(profileId: string) {
  if (profileId === state.value.profile) return
  showProfileConfirm.value = profileId
}

function confirmProfileChange() {
  if (!showProfileConfirm.value) return
  applyProfile(showProfileConfirm.value)
  showProfileConfirm.value = null
  profileAppliedFlash.value = true
  setTimeout(() => { profileAppliedFlash.value = false }, 2500)
}

const pendingProfileInfo = computed(() => {
  if (!showProfileConfirm.value) return null
  const profile = profiles.find(p => p.id === showProfileConfirm.value)
  if (!profile) return null
  return { title: profile.title, description: profile.description, naCount: profile.notApplicable.length }
})

function toggleExpand(id: string) {
  expandedControl.value = expandedControl.value === id ? null : id
}

function handleExport() {
  const json = exportState()
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `openclaw-security-assessment-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

function handleReset() {
  resetAll()
  showResetConfirm.value = false
}

async function copyCheck(text: string, id: string) {
  await navigator.clipboard.writeText(text)
  copiedId.value = id
  setTimeout(() => { copiedId.value = null }, 2000)
}

const severityColors: Record<string, string> = {
  critical: '#e53e3e',
  high: '#dd6b20',
  medium: '#d69e2e',
  low: '#38a169',
}

const statusLabels: Record<ControlStatus, string> = {
  compliant: 'Compliant',
  'non-compliant': 'Non-Compliant',
  'not-applicable': 'N/A',
  unreviewed: 'Unreviewed',
}

const statusIcons: Record<ControlStatus, string> = {
  compliant: '\u2713',
  'non-compliant': '\u2717',
  'not-applicable': '\u2014',
  unreviewed: '\u25CB',
}
</script>

<template>
  <div class="checklist-root">
    <!-- Dashboard Header -->
    <div class="dashboard">
      <div class="dashboard-score">
        <div class="score-circle" :style="{ '--pct': stats.compliancePercent }">
          <span class="score-value">{{ stats.compliancePercent }}%</span>
        </div>
        <div class="score-label">
          {{ stats.compliant }} / {{ stats.applicable }} compliant
        </div>
      </div>

      <div class="dashboard-breakdown">
        <div class="breakdown-row" v-for="s in stats.bySeverity" :key="s.severity">
          <span class="sev-badge" :style="{ backgroundColor: severityColors[s.severity] }">
            {{ s.severity }}
          </span>
          <span class="breakdown-count">{{ s.compliant }} / {{ s.applicable }}</span>
          <div class="breakdown-bar">
            <div
              class="breakdown-fill"
              :style="{
                width: s.applicable > 0 ? ((s.compliant / s.applicable) * 100) + '%' : '0%',
                backgroundColor: severityColors[s.severity],
              }"
            />
          </div>
        </div>
        <div class="breakdown-meta">
          {{ stats.reviewed }} of {{ stats.total }} reviewed
          <template v-if="stats.notApplicable > 0">
            &middot; {{ stats.notApplicable }} N/A
          </template>
        </div>
      </div>

      <div class="dashboard-actions">
        <div class="profile-select">
          <label>Profile</label>
          <select :value="state.profile" @change="handleProfileChange(($event.target as HTMLSelectElement).value)">
            <option v-for="p in profiles" :key="p.id" :value="p.id">{{ p.title }}</option>
          </select>
        </div>
        <button class="btn btn-export" @click="handleExport">Export JSON</button>
        <button class="btn btn-reset" @click="showResetConfirm = true">Reset</button>
      </div>
    </div>

    <!-- Profile Change Confirmation -->
    <div v-if="pendingProfileInfo" class="profile-confirm">
      <p>
        Switch to <strong>{{ pendingProfileInfo.title }}</strong> profile?
        {{ pendingProfileInfo.description }}
        <template v-if="pendingProfileInfo.naCount > 0">
          This will mark {{ pendingProfileInfo.naCount }} controls as N/A.
        </template>
        <template v-else>
          All 77 controls will apply.
        </template>
      </p>
      <button class="btn btn-export" @click="confirmProfileChange">Apply</button>
      <button class="btn" @click="showProfileConfirm = null">Cancel</button>
    </div>

    <!-- Profile Applied Flash -->
    <div v-if="profileAppliedFlash" class="profile-flash">
      Profile applied. Controls updated.
    </div>

    <!-- Reset Confirmation -->
    <div v-if="showResetConfirm" class="reset-confirm">
      <p>Clear all checklist progress? This cannot be undone.</p>
      <button class="btn btn-reset" @click="handleReset">Yes, reset</button>
      <button class="btn" @click="showResetConfirm = false">Cancel</button>
    </div>

    <!-- Filters -->
    <div class="filters">
      <div class="filter-group">
        <label>Category</label>
        <select v-model="activeCategory">
          <option :value="null">All categories</option>
          <option v-for="cat in categoryStats" :key="cat.id" :value="cat.id">
            {{ cat.title }} ({{ cat.compliant }}/{{ cat.total }})
          </option>
        </select>
      </div>
      <div class="filter-group">
        <label>Severity</label>
        <select v-model="severityFilter">
          <option value="all">All</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>
      <div class="filter-group">
        <label>Status</label>
        <select v-model="statusFilter">
          <option value="all">All</option>
          <option value="unreviewed">Unreviewed</option>
          <option value="compliant">Compliant</option>
          <option value="non-compliant">Non-Compliant</option>
          <option value="not-applicable">N/A</option>
        </select>
      </div>
      <div class="filter-count">{{ filteredControls.length }} controls</div>
    </div>

    <!-- Category headers inline -->
    <template v-if="!activeCategory">
      <div v-for="cat in categoryStats" :key="cat.id" class="category-section">
        <h3 class="category-header" @click="activeCategory = cat.id">
          <span class="category-ring" :data-ring="cat.ring">{{ cat.ring }}</span>
          {{ cat.title }}
          <span class="category-count">{{ cat.compliant }}/{{ cat.total }}</span>
        </h3>
        <p class="category-risk">{{ cat.riskTheme }}</p>
        <div class="controls-list">
          <div
            v-for="control in controls.filter(c => c.category === cat.id).filter(c => severityFilter === 'all' || c.severity === severityFilter).filter(c => statusFilter === 'all' || getControlState(c.id).status === statusFilter)"
            :key="control.id"
            class="control-card"
            :class="'status-' + getControlState(control.id).status"
          >
            <div class="control-header" @click="toggleExpand(control.id)">
              <span class="control-status-icon">{{ statusIcons[getControlState(control.id).status] }}</span>
              <span class="sev-badge sev-badge-sm" :style="{ backgroundColor: severityColors[control.severity] }">
                {{ control.severity }}
              </span>
              <span class="control-title">{{ control.title }}</span>
              <code class="control-config">{{ control.configPath }}</code>
              <span class="control-expand">{{ expandedControl === control.id ? '\u25B2' : '\u25BC' }}</span>
            </div>

            <div v-if="expandedControl === control.id" class="control-body">
              <div class="control-field">
                <strong>Risk:</strong> {{ control.risk }}
              </div>
              <div class="control-field">
                <strong>Recommendation:</strong> {{ control.recommendation }}
              </div>
              <div class="control-field control-check">
                <strong>Verify:</strong>
                <code>{{ control.check }}</code>
                <button class="btn-copy" @click.stop="copyCheck(control.check, control.id)">
                  {{ copiedId === control.id ? 'Copied' : 'Copy' }}
                </button>
              </div>
              <div v-if="control.options" class="control-field">
                <strong>Options:</strong>
                <span v-for="v in control.options.values" :key="String(v)"
                  class="option-chip"
                  :class="{ recommended: v === control.options!.recommended }"
                >
                  {{ v }}{{ v === control.options!.recommended ? ' *' : '' }}
                </span>
              </div>
              <div v-if="control.auditCheckId" class="control-field">
                <strong>Audit check:</strong> <code>{{ control.auditCheckId }}</code>
              </div>
              <div class="control-field">
                <a :href="control.docRef" class="doc-link">View documentation &rarr;</a>
              </div>

              <!-- Status toggles -->
              <div class="status-toggles">
                <button
                  v-for="(label, key) in statusLabels"
                  :key="key"
                  class="status-btn"
                  :class="{ active: getControlState(control.id).status === key }"
                  @click.stop="setControlStatus(control.id, key as ControlStatus)"
                >
                  {{ statusIcons[key as ControlStatus] }} {{ label }}
                </button>
              </div>

              <!-- Notes -->
              <div class="control-notes">
                <textarea
                  :value="getControlState(control.id).notes"
                  @input="setControlNotes(control.id, ($event.target as HTMLTextAreaElement).value)"
                  placeholder="Add notes..."
                  rows="2"
                  @click.stop
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- Single category view -->
    <template v-else>
      <button class="btn btn-back" @click="activeCategory = null">&larr; All categories</button>
      <div class="controls-list">
        <div
          v-for="control in filteredControls"
          :key="control.id"
          class="control-card"
          :class="'status-' + getControlState(control.id).status"
        >
          <div class="control-header" @click="toggleExpand(control.id)">
            <span class="control-status-icon">{{ statusIcons[getControlState(control.id).status] }}</span>
            <span class="sev-badge sev-badge-sm" :style="{ backgroundColor: severityColors[control.severity] }">
              {{ control.severity }}
            </span>
            <span class="control-title">{{ control.title }}</span>
            <code class="control-config">{{ control.configPath }}</code>
            <span class="control-expand">{{ expandedControl === control.id ? '\u25B2' : '\u25BC' }}</span>
          </div>

          <div v-if="expandedControl === control.id" class="control-body">
            <div class="control-field">
              <strong>Risk:</strong> {{ control.risk }}
            </div>
            <div class="control-field">
              <strong>Recommendation:</strong> {{ control.recommendation }}
            </div>
            <div class="control-field control-check">
              <strong>Verify:</strong>
              <code>{{ control.check }}</code>
              <button class="btn-copy" @click.stop="copyCheck(control.check, control.id)">
                {{ copiedId === control.id ? 'Copied' : 'Copy' }}
              </button>
            </div>
            <div v-if="control.options" class="control-field">
              <strong>Options:</strong>
              <span v-for="v in control.options.values" :key="String(v)"
                class="option-chip"
                :class="{ recommended: v === control.options!.recommended }"
              >
                {{ v }}{{ v === control.options!.recommended ? ' *' : '' }}
              </span>
            </div>
            <div v-if="control.auditCheckId" class="control-field">
              <strong>Audit check:</strong> <code>{{ control.auditCheckId }}</code>
            </div>
            <div class="control-field">
              <a :href="control.docRef" class="doc-link">View documentation &rarr;</a>
            </div>

            <div class="status-toggles">
              <button
                v-for="(label, key) in statusLabels"
                :key="key"
                class="status-btn"
                :class="{ active: getControlState(control.id).status === key }"
                @click.stop="setControlStatus(control.id, key as ControlStatus)"
              >
                {{ statusIcons[key as ControlStatus] }} {{ label }}
              </button>
            </div>

            <div class="control-notes">
              <textarea
                :value="getControlState(control.id).notes"
                @input="setControlNotes(control.id, ($event.target as HTMLTextAreaElement).value)"
                placeholder="Add notes..."
                rows="2"
                @click.stop
              />
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.checklist-root {
  max-width: 100%;
  font-size: 14px;
}

/* Dashboard */
.dashboard {
  display: flex;
  gap: 28px;
  align-items: flex-start;
  padding: 24px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  margin-bottom: 24px;
  flex-wrap: wrap;
  background: var(--vp-c-bg-soft);
}

.dashboard-score {
  text-align: center;
  min-width: 100px;
}

.score-circle {
  width: 90px;
  height: 90px;
  border-radius: 50%;
  background: conic-gradient(
    var(--vp-c-brand-1) calc(var(--pct) * 1%),
    var(--vp-c-divider) calc(var(--pct) * 1%)
  );
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 8px;
  position: relative;
}

.score-circle::after {
  content: '';
  position: absolute;
  width: 68px;
  height: 68px;
  border-radius: 50%;
  background: var(--vp-c-bg-soft);
}

.score-value {
  position: relative;
  z-index: 1;
  font-size: 20px;
  font-weight: 700;
}

.score-label {
  font-size: 12px;
  color: var(--vp-c-text-2);
}

.dashboard-breakdown {
  flex: 1;
  min-width: 200px;
}

.breakdown-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.sev-badge {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 4px;
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  min-width: 60px;
  text-align: center;
}

.sev-badge-sm {
  padding: 0 6px;
  font-size: 10px;
  min-width: 50px;
}

.breakdown-count {
  font-size: 12px;
  min-width: 40px;
  color: var(--vp-c-text-2);
}

.breakdown-bar {
  flex: 1;
  height: 6px;
  background: var(--vp-c-divider);
  border-radius: 3px;
  overflow: hidden;
}

.breakdown-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.3s ease;
}

.breakdown-meta {
  font-size: 11px;
  color: var(--vp-c-text-3);
  margin-top: 4px;
}

.dashboard-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 140px;
}

.profile-select label {
  display: block;
  font-size: 11px;
  color: var(--vp-c-text-2);
  margin-bottom: 4px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.profile-select select,
.filter-group select {
  width: 100%;
  padding: 4px 8px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font-size: 13px;
}

.btn {
  padding: 6px 12px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  cursor: pointer;
  font-size: 12px;
}

.btn:hover {
  border-color: var(--vp-c-brand-1);
}

.btn-export {
  background: var(--vp-c-brand-1);
  color: #fff;
  border-color: var(--vp-c-brand-1);
}

.btn-reset {
  color: #e53e3e;
  border-color: #e53e3e;
}

.btn-back {
  margin-bottom: 16px;
}

/* Profile confirm */
.profile-confirm {
  padding: 14px 18px;
  border: 1px solid var(--vp-c-brand-1);
  border-radius: 8px;
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--vp-c-brand-soft);
}

.profile-confirm p {
  margin: 0;
  flex: 1;
  font-size: 13px;
  line-height: 1.5;
}

.profile-flash {
  padding: 10px 16px;
  border-radius: 8px;
  margin-bottom: 16px;
  font-size: 13px;
  font-weight: 500;
  background: #c6f6d5;
  color: #276749;
  text-align: center;
  animation: flash-fade 2.5s ease-out forwards;
}

:root.dark .profile-flash {
  background: #1c4532;
  color: #c6f6d5;
}

@keyframes flash-fade {
  0%, 70% { opacity: 1; }
  100% { opacity: 0; }
}

/* Reset confirm */
.reset-confirm {
  padding: 14px 18px;
  border: 1px solid #e53e3e;
  border-radius: 8px;
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  gap: 12px;
}

.reset-confirm p {
  margin: 0;
  flex: 1;
  font-size: 13px;
}

/* Filters */
.filters {
  display: flex;
  gap: 12px;
  align-items: flex-end;
  margin-bottom: 24px;
  flex-wrap: wrap;
  padding: 12px 16px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
}

.filter-group {
  min-width: 140px;
}

.filter-group label {
  display: block;
  font-size: 11px;
  color: var(--vp-c-text-2);
  margin-bottom: 4px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.filter-count {
  font-size: 12px;
  color: var(--vp-c-text-3);
  align-self: center;
  padding-bottom: 4px;
  margin-left: auto;
  font-weight: 500;
}

/* Category sections */
.category-section {
  margin-bottom: 36px;
}

.category-header {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  margin: 0 0 6px;
  font-size: 17px;
  border: none;
  background: none;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--vp-c-divider);
}

.category-header:hover {
  color: var(--vp-c-brand-1);
}

.category-ring {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  background: var(--vp-c-divider);
  color: var(--vp-c-text-2);
}

.category-ring[data-ring="Gateway"] { background: #ebf8ff; color: #2b6cb0; }
.category-ring[data-ring="Sessions"] { background: #fefcbf; color: #975a16; }
.category-ring[data-ring="Tools"] { background: #feebc8; color: #c05621; }
.category-ring[data-ring="Sandbox"] { background: #fed7e2; color: #b83280; }
.category-ring[data-ring="Host"] { background: #e9d8fd; color: #6b46c1; }
.category-ring[data-ring="Model"] { background: #c6f6d5; color: #276749; }

:root.dark .category-ring[data-ring="Gateway"] { background: #1a365d; color: #90cdf4; }
:root.dark .category-ring[data-ring="Sessions"] { background: #5f370e; color: #fefcbf; }
:root.dark .category-ring[data-ring="Tools"] { background: #652b19; color: #feebc8; }
:root.dark .category-ring[data-ring="Sandbox"] { background: #521b41; color: #fed7e2; }
:root.dark .category-ring[data-ring="Host"] { background: #322659; color: #e9d8fd; }
:root.dark .category-ring[data-ring="Model"] { background: #1c4532; color: #c6f6d5; }

.category-count {
  margin-left: auto;
  font-size: 12px;
  color: var(--vp-c-text-3);
  font-weight: 400;
}

.category-risk {
  font-size: 13px;
  color: var(--vp-c-text-3);
  margin: 8px 0 14px;
  font-style: italic;
}

/* Control cards */
.controls-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.control-card {
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  overflow: hidden;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.control-card:hover {
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}

.control-card.status-compliant {
  border-left: 3px solid #38a169;
}

.control-card.status-non-compliant {
  border-left: 3px solid #e53e3e;
}

.control-card.status-not-applicable {
  border-left: 3px solid var(--vp-c-divider);
  opacity: 0.7;
}

.control-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  cursor: pointer;
  user-select: none;
}

.control-header:hover {
  background: var(--vp-c-bg-soft);
}

.control-status-icon {
  font-size: 14px;
  width: 18px;
  text-align: center;
}

.control-title {
  font-weight: 500;
  flex: 1;
}

.control-config {
  font-size: 11px;
  color: var(--vp-c-text-3);
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.control-expand {
  font-size: 10px;
  color: var(--vp-c-text-3);
}

/* Control body */
.control-body {
  padding: 16px 20px;
  border-top: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
}

.control-field {
  margin-bottom: 8px;
  font-size: 13px;
  line-height: 1.5;
}

.control-field strong {
  color: var(--vp-c-text-1);
}

.control-check {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  flex-wrap: wrap;
}

.control-check code {
  flex: 1;
  font-size: 12px;
  padding: 6px 10px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  word-break: break-all;
  min-width: 200px;
}

.btn-copy {
  padding: 2px 8px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-2);
  cursor: pointer;
  font-size: 11px;
  white-space: nowrap;
}

.btn-copy:hover {
  border-color: var(--vp-c-brand-1);
}

.option-chip {
  display: inline-block;
  padding: 1px 6px;
  margin: 2px 4px 2px 0;
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  font-size: 11px;
  font-family: var(--vp-font-family-mono);
}

.option-chip.recommended {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  font-weight: 600;
}

.doc-link {
  font-size: 12px;
  color: var(--vp-c-brand-1);
}

/* Status toggles */
.status-toggles {
  display: flex;
  gap: 6px;
  margin: 12px 0 8px;
  flex-wrap: wrap;
}

.status-btn {
  padding: 6px 12px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-2);
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  transition: all 0.15s;
}

.status-btn:hover {
  border-color: var(--vp-c-brand-1);
}

.status-btn.active {
  background: var(--vp-c-brand-1);
  color: #fff;
  border-color: var(--vp-c-brand-1);
}

/* Notes */
.control-notes textarea {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font-size: 12px;
  font-family: inherit;
  resize: vertical;
}

.control-notes textarea:focus {
  outline: none;
  border-color: var(--vp-c-brand-1);
}

:root.dark .control-card:hover {
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
}

/* Responsive */
@media (max-width: 768px) {
  .dashboard {
    flex-direction: column;
  }

  .control-config {
    display: none;
  }

  .control-check {
    flex-direction: column;
  }

  .filters {
    padding: 10px 12px;
  }

  .filter-group {
    min-width: 100px;
    flex: 1;
  }
}
</style>
