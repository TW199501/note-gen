import dayjs from 'dayjs'

import { getAllActivityEvents } from '@/db/activity'
import { buildActivityHeatmap, summarizeActivityEntries } from './aggregate'
import type { ActivityCalendarData, ActivityDaySummary, ActivityEntry, ActivityHeatmapWeek } from './types'

function getBrowserTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

function getDefaultRange() {
  const today = dayjs()
  const startDate = today.subtract(25, 'week').startOf('week')
  const endDate = today.endOf('week')

  return {
    startDate: startDate.format('YYYY-MM-DD'),
    endDate: endDate.format('YYYY-MM-DD'),
  }
}

async function loadActivityEntries(): Promise<ActivityEntry[]> {
  const events = await getAllActivityEvents()

  return events.map(event => ({
    id: `${event.source}-${event.id}`,
    source: event.source,
    timestamp: event.createdAt,
    title: event.title,
    description: event.description ?? undefined,
    path: event.path ?? undefined,
    tagId: event.tagId ?? undefined,
  }))
}

function buildTotals(days: ActivityDaySummary[]) {
  return days.reduce((totals, day) => {
    totals.totalCount += day.totalCount
    totals.recordCount += day.counts.record
    totals.chatCount += day.counts.chat
    totals.writingCount += day.counts.writing
    if (day.totalCount > 0) {
      totals.activeDays += 1
    }
    return totals
  }, {
    totalCount: 0,
    activeDays: 0,
    recordCount: 0,
    chatCount: 0,
    writingCount: 0,
  })
}

export async function loadActivityCalendarData(): Promise<ActivityCalendarData> {
  const timeZone = getBrowserTimeZone()
  const { startDate, endDate } = getDefaultRange()

  let entries: ActivityEntry[] = []

  try {
    entries = await loadActivityEntries()
  } catch (error) {
    console.error('Failed to load activity events:', error)
  }

  const days = summarizeActivityEntries(entries, { timeZone }) as ActivityDaySummary[]
  const heatmap = buildActivityHeatmap(days, { startDate, endDate }) as {
    weeks: ActivityHeatmapWeek[]
  }

  return {
    timeZone,
    startDate,
    endDate,
    generatedAt: Date.now(),
    totals: buildTotals(days),
    days,
    weeks: heatmap.weeks,
  }
}
