// Modified by GNATOVSKIE for integration into Paseo HQ, 2026-11-10.
// A composer pill per chat whose reply queue has items: open it to review the
// queued parts, then send them or clear them.
import type { PluginClientContext } from "@getpaseo/plugin/client";
import type { PluginButtonContentProps, PluginButtonRegistration } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { composeReply } from "../../shared/genui/logic/reply";
import { clearQueue, knownQueueAgents, queueOf, setQueued, subscribeQueues, useReplyQueue } from "./reply-queue";

export function registerQueuePills(client: PluginClientContext): () => void {
  const pills = new Map<string, PluginButtonRegistration>();
  const pending = new Set<string>();

  const label = (count: number) => `${count} queued`;

  const sync = () => {
    for (const agentId of knownQueueAgents()) {
      if (agentId === "local") continue;
      const count = queueOf(agentId).length;
      const pill = pills.get(agentId);
      if (count === 0) {
        pill?.remove();
        pills.delete(agentId);
      } else if (pill) {
        pill.update({ label: label(count) });
      } else if (!pending.has(agentId)) {
        pending.add(agentId);
        void register(agentId).finally(() => pending.delete(agentId));
      }
    }
  };

  const register = async (agentId: string) => {
    const agent = client.paseo.agents.ref(agentId);
    if (agent.workspaceId === null) await agent.refresh();
    const workspaceId = agent.workspaceId;
    const count = queueOf(agentId).length;
    if (workspaceId === null || count === 0 || pills.has(agentId)) return;
    pills.set(
      agentId,
      client.addComposerPill({
        id: `reply-queue-${agentId}`,
        workspaceId,
        agentId,
        button: {
          title: "Queued reply",
          label: label(count),
          icon: "MessageSquare",
          behavior: {
            kind: "popover",
            Content: (props) => (
              <QueuePopover {...props} send={(text) => client.paseo.agents.ref(agentId).send(text)} />
            ),
          },
        },
      }),
    );
  };

  const unsubscribe = subscribeQueues(sync);
  sync();
  return () => {
    unsubscribe();
    for (const pill of pills.values()) pill.remove();
    pills.clear();
  };
}

function QueuePopover({
  theme,
  close,
  send,
  ...context
}: PluginButtonContentProps & { send(text: string): Promise<void> }) {
  const agentId = context.context === "agent" ? context.agentId : null;
  const queue = useReplyQueue(agentId);
  if (agentId === null) return null;

  return (
    <View style={{ gap: 8, padding: 12, maxWidth: 420 }}>
      {queue.map((item) => (
        <View key={item.id} style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
          <Text style={{ color: theme.colors.foreground, fontSize: 12.5, flex: 1 }}>{item.text}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Remove" onPress={() => setQueued(agentId, item.id, null)}>
            <Icon name="Trash2" size={13} color={theme.colors.foregroundMuted} />
          </Pressable>
        </View>
      ))}
      <View style={{ flexDirection: "row", gap: 8, paddingTop: 4 }}>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            const text = composeReply(queueOf(agentId).map((item) => item.text), null);
            if (text === "") return;
            void send(text).then(() => clearQueue(agentId));
            close();
          }}
          style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: theme.colors.accent }}
        >
          <Text style={{ color: theme.colors.accentForeground, fontSize: 12.5, fontWeight: "600" }}>Send now</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            clearQueue(agentId);
            close();
          }}
          style={{
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderRadius: 8,
            backgroundColor: theme.colors.surface2,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.colors.border,
          }}
        >
          <Text style={{ color: theme.colors.foreground, fontSize: 12.5, fontWeight: "600" }}>Clear</Text>
        </Pressable>
      </View>
    </View>
  );
}
