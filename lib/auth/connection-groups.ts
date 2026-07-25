export type OAuthConnectionItem = {
  id: string
  label: string
  clientId: string | null
  status: string
  scopes: string[]
  createdAt: string
  lastUsedAt: string | null
}

export type OAuthConnectionGroup = {
  key: string
  ids: string[]
  label: string
  clientId: string | null
  scopes: string[]
  createdAt: string
  lastUsedAt: string | null
}

function activityTime(connection: {
  createdAt: string
  lastUsedAt: string | null
}) {
  return new Date(connection.lastUsedAt ?? connection.createdAt).getTime()
}

export function groupActiveOAuthConnections(
  connections: OAuthConnectionItem[]
): OAuthConnectionGroup[] {
  const groups = new Map<string, OAuthConnectionGroup>()

  for (const connection of connections) {
    if (connection.status !== "active") continue
    const key = connection.clientId ?? connection.id
    const existing = groups.get(key)
    if (!existing) {
      groups.set(key, {
        key,
        ids: [connection.id],
        label: connection.label,
        clientId: connection.clientId,
        scopes: [...connection.scopes],
        createdAt: connection.createdAt,
        lastUsedAt: connection.lastUsedAt,
      })
      continue
    }

    existing.ids.push(connection.id)
    existing.scopes = [...new Set([...existing.scopes, ...connection.scopes])]
    if (activityTime(connection) > activityTime(existing)) {
      existing.label = connection.label
      existing.createdAt = connection.createdAt
      existing.lastUsedAt = connection.lastUsedAt
    }
  }

  return [...groups.values()].sort(
    (a, b) => activityTime(b) - activityTime(a)
  )
}
