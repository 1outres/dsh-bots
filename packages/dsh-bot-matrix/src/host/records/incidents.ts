import { type IncidentRecord, incidentKey, type MatrixTables } from "./domain"

export interface IncidentRecords {
  shown(incidentId: string): boolean
  save(notice: Omit<IncidentRecord, "botId">): Promise<void>
}

export function openIncidentRecords(
  tables: Pick<MatrixTables, "incidents">,
  botId: string,
): IncidentRecords {
  return {
    shown: (incidentId) => tables.incidents.get(incidentKey(botId, incidentId)) !== undefined,
    save: (notice) =>
      tables.incidents.put(incidentKey(botId, notice.incidentId), { ...notice, botId }),
  }
}
