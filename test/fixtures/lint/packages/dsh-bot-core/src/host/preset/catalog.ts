import { createHash } from "node:crypto" // rule: 14
import { createUserMessage } from "@deepseek-ai/dsh-llm" // rule: 12

export const values = [createHash, createUserMessage]
