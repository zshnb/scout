import { z } from 'zod'

const index = z.number().int().nonnegative().max(45)
export const nameSchema = z.string().trim().min(1).max(16)
  .regex(/^[\p{L}\p{M}\p{N} _.-]+$/u, '昵称仅支持文字、数字、空格、点、下划线和短横线')
export const seatRequest = z.strictObject({ name: nameSchema, token: z.string().uuid().optional() })
export const codePattern = /^[A-HJ-NP-Z2-9]{6}$/
export const codeSchema = z.string().regex(codePattern)
export const credentialsSchema = z.object({ code: codeSchema, token: z.string().uuid() })
const pickFields = { end: z.enum(['left', 'right']), flip: z.boolean(), at: index }
const rangeFields = { from: index, to: index }
export const actionSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('start') }),
  z.strictObject({ type: z.literal('orient'), rotate: z.boolean() }),
  z.strictObject({ type: z.literal('show'), ...rangeFields }),
  z.strictObject({ type: z.literal('scout'), ...pickFields }),
  z.strictObject({ type: z.literal('combo'), ...pickFields, ...rangeFields }),
  z.strictObject({ type: z.literal('next') }),
])
export type Action = z.infer<typeof actionSchema>
export type Pick = Omit<Extract<Action, { type: 'scout' }>, 'type'>
export const commandSchema = z.strictObject({
  revision: z.number().int().nonnegative(), action: actionSchema,
})
const value = z.number().int().min(1).max(10)
const card = z.tuple([value, value])
export type Card = z.infer<typeof card>
const result = z.object({
  reason: z.enum(['empty', 'unchallenged', 'blocked']), winner: index,
  scores: z.array(z.object({ captured: index, chips: z.number().int().nonnegative(), penalty: index, points: z.number().int() })),
})
export type RoundResult = z.infer<typeof result>
const player = z.object({
  name: nameSchema, count: index, ready: z.boolean(), chips: z.number().int().nonnegative(),
  captured: index, comboUsed: z.boolean(), total: z.number().int(),
})
export const viewSchema = z.object({
  code: codeSchema, revision: z.number().int().nonnegative(), me: index,
  phase: z.enum(['lobby', 'orient', 'play', 'result', 'finished']),
  round: index, starter: index, turn: index,
  hand: z.array(card), table: z.array(card), owner: index.nullable(),
  players: z.array(player).min(1).max(5), result: result.nullable(),
})
export type View = z.infer<typeof viewSchema>
export const responseSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('view'), view: viewSchema }),
  z.object({ type: z.literal('error'), message: z.string(), view: viewSchema }),
])
