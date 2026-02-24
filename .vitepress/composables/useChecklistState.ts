import { useLocalStorage } from '@vueuse/core'
import { computed } from 'vue'
import { controls, categories, profiles, type ChecklistControl } from '../checklist-data'

export type ControlStatus = 'compliant' | 'non-compliant' | 'not-applicable' | 'unreviewed'

interface ControlState {
  status: ControlStatus
  notes: string
  lastModified: string
}

interface ChecklistState {
  version: number
  lastUpdated: string
  profile: string
  controls: Record<string, ControlState>
}

const DEFAULT_STATE: ChecklistState = {
  version: 1,
  lastUpdated: new Date().toISOString(),
  profile: 'personal',
  controls: {},
}

export function useChecklistState() {
  const state = useLocalStorage<ChecklistState>('openclaw-security-checklist', DEFAULT_STATE, {
    mergeDefaults: true,
  })

  function getControlState(id: string): ControlState {
    return state.value.controls[id] || { status: 'unreviewed', notes: '', lastModified: '' }
  }

  function setControlStatus(id: string, status: ControlStatus) {
    if (!state.value.controls[id]) {
      state.value.controls[id] = { status: 'unreviewed', notes: '', lastModified: '' }
    }
    state.value.controls[id].status = status
    state.value.controls[id].lastModified = new Date().toISOString()
    state.value.lastUpdated = new Date().toISOString()
  }

  function setControlNotes(id: string, notes: string) {
    if (!state.value.controls[id]) {
      state.value.controls[id] = { status: 'unreviewed', notes: '', lastModified: '' }
    }
    state.value.controls[id].notes = notes
    state.value.controls[id].lastModified = new Date().toISOString()
    state.value.lastUpdated = new Date().toISOString()
  }

  function applyProfile(profileId: string) {
    const profile = profiles.find(p => p.id === profileId)
    if (!profile) return

    const oldProfile = profiles.find(p => p.id === state.value.profile)
    state.value.profile = profileId

    // Reset controls that were auto-N/A'd by the previous profile
    if (oldProfile) {
      for (const id of oldProfile.notApplicable) {
        const ctrl = state.value.controls[id]
        if (ctrl && ctrl.status === 'not-applicable' && ctrl.notes.includes('profile')) {
          state.value.controls[id] = { status: 'unreviewed', notes: '', lastModified: new Date().toISOString() }
        }
      }
    }

    // Initialize any missing controls
    for (const control of controls) {
      if (!state.value.controls[control.id]) {
        state.value.controls[control.id] = { status: 'unreviewed', notes: '', lastModified: '' }
      }
    }

    // Apply N/A presets for new profile
    for (const id of profile.notApplicable) {
      state.value.controls[id] = {
        status: 'not-applicable',
        notes: `Auto-set by ${profile.title} profile`,
        lastModified: new Date().toISOString(),
      }
    }

    state.value.lastUpdated = new Date().toISOString()
  }

  function resetAll() {
    state.value = {
      version: 1,
      lastUpdated: new Date().toISOString(),
      profile: 'personal',
      controls: {},
    }
  }

  function exportState(): string {
    return JSON.stringify({
      exportedAt: new Date().toISOString(),
      profile: state.value.profile,
      summary: {
        total: controls.length,
        compliant: controls.filter(c => getControlState(c.id).status === 'compliant').length,
        nonCompliant: controls.filter(c => getControlState(c.id).status === 'non-compliant').length,
        notApplicable: controls.filter(c => getControlState(c.id).status === 'not-applicable').length,
        unreviewed: controls.filter(c => getControlState(c.id).status === 'unreviewed').length,
      },
      controls: controls.map(c => ({
        id: c.id,
        title: c.title,
        category: c.category,
        severity: c.severity,
        configPath: c.configPath,
        ...getControlState(c.id),
      })),
    }, null, 2)
  }

  // Computed stats
  const stats = computed(() => {
    const total = controls.length
    const reviewed = controls.filter(c => getControlState(c.id).status !== 'unreviewed').length
    const compliant = controls.filter(c => getControlState(c.id).status === 'compliant').length
    const nonCompliant = controls.filter(c => getControlState(c.id).status === 'non-compliant').length
    const notApplicable = controls.filter(c => getControlState(c.id).status === 'not-applicable').length
    const applicable = total - notApplicable
    const compliancePercent = applicable > 0 ? Math.round((compliant / applicable) * 100) : 0

    const bySeverity = (['critical', 'high', 'medium', 'low'] as const).map(sev => {
      const sevControls = controls.filter(c => c.severity === sev)
      const sevCompliant = sevControls.filter(c => getControlState(c.id).status === 'compliant').length
      const sevNA = sevControls.filter(c => getControlState(c.id).status === 'not-applicable').length
      return { severity: sev, total: sevControls.length, compliant: sevCompliant, applicable: sevControls.length - sevNA }
    })

    return { total, reviewed, compliant, nonCompliant, notApplicable, applicable, compliancePercent, bySeverity }
  })

  const categoryStats = computed(() => {
    return categories.map(cat => {
      const catControls = controls.filter(c => c.category === cat.id)
      const reviewed = catControls.filter(c => getControlState(c.id).status !== 'unreviewed').length
      const compliant = catControls.filter(c => getControlState(c.id).status === 'compliant').length
      return { ...cat, total: catControls.length, reviewed, compliant }
    })
  })

  return {
    state,
    controls,
    categories,
    profiles,
    getControlState,
    setControlStatus,
    setControlNotes,
    applyProfile,
    resetAll,
    exportState,
    stats,
    categoryStats,
  }
}
