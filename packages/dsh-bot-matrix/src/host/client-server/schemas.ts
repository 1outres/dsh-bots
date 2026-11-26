import { z } from "zod"

export const errorBodySchema = z.object({
  errcode: z.string().optional(),
  error: z.string().optional(),
  retry_after_ms: z.number().int().nonnegative().optional(),
})

const content = z.record(z.string(), z.unknown())

export const eventSchema = z.object({
  event_id: z.string().min(1),
  type: z.string(),
  sender: z.string(),
  origin_server_ts: z.number(),
  content: content.default({}),
  state_key: z.string().optional(),
  redacts: z.string().optional(),
})

export const strippedStateSchema = z.object({
  type: z.string(),
  sender: z.string(),
  state_key: z.string(),
  content: content.default({}),
})

const events = z.array(z.unknown()).default([])

export const syncSchema = z.object({
  next_batch: z.string().min(1),
  rooms: z
    .object({
      join: z
        .record(
          z.string(),
          z.object({
            timeline: z
              .object({
                events,
                limited: z.boolean().optional(),
                prev_batch: z.string().optional(),
              })
              .default({ events: [] }),
            state: z.object({ events }).default({ events: [] }),
          }),
        )
        .default({}),
      invite: z
        .record(
          z.string(),
          z.object({ invite_state: z.object({ events }).default({ events: [] }) }),
        )
        .default({}),
      leave: z.record(z.string(), z.unknown()).default({}),
    })
    .default({ join: {}, invite: {}, leave: {} }),
})

export const messagesSchema = z.object({ chunk: events, end: z.string().optional() })

export const versionsSchema = z.object({ versions: z.array(z.string()) })

export const whoamiSchema = z.object({ user_id: z.string().min(1) })

export const mediaConfigSchema = z.object({
  "m.upload.size": z.number().int().positive().optional(),
})

export const eventIdSchema = z.object({ event_id: z.string().min(1) })

export const roomIdSchema = z.object({ room_id: z.string().min(1) })

export const joinedRoomsSchema = z.object({ joined_rooms: z.array(z.string()) })

export const membersSchema = z.object({ chunk: events })

export const profileSchema = z.object({
  displayname: z.string().nullable().optional(),
  avatar_url: z.string().nullable().optional(),
})

export const uploadSchema = z.object({ content_uri: z.string().startsWith("mxc://") })

export const objectSchema = content
