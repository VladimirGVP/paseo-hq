// Modified by GNATOVSKIE for integration into Paseo HQ, 2026-11-10.
import React, { Component, type ComponentClass, type ComponentType, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { ComponentName } from "../../shared/genui/core/catalog";
import { defineClass } from "../../shared/genui/core/define-class";
import type { UiNode } from "../../shared/genui/core/types";
import { text, type Props } from "../../shared/genui/logic/values";
import { useUiRuntime } from "./runtime";

export interface GroupedButton {
  readonly key: string;
  readonly props: Props;
  readonly element: ReactNode;
}

let renderersMap: Record<ComponentName, ComponentType<{ props: Props }>> | null = null;
let buttonGroupComponent: ComponentType<{ buttons: readonly GroupedButton[] }> | null = null;

export function registerRenderers(
  map: Record<ComponentName, ComponentType<{ props: Props }>>,
  buttonGroup: ComponentType<{ buttons: readonly GroupedButton[] }>,
): void {
  renderersMap = map;
  buttonGroupComponent = buttonGroup;
}

export function ErrorLine({ message }: { message: string }) {
  const { theme } = useUiRuntime();
  return (
    <View
      style={{
        borderRadius: 8,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.statusDanger,
        backgroundColor: theme.colors.surface1,
        paddingHorizontal: 10,
        paddingVertical: 6,
      }}
    >
      <Text selectable style={{ color: theme.colors.statusDanger, fontSize: 12 }}>
        {message}
      </Text>
    </View>
  );
}

export function LoadingPlaceholder({
  path,
  component,
}: {
  path: string;
  component: string | null;
}) {
  const { theme } = useUiRuntime();
  return (
    <View
      style={{
        borderRadius: 8,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
        paddingHorizontal: 12,
        paddingVertical: 10,
      }}
    >
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
        {component ? `Loading ${component} (${path})…` : `Loading ${path}…`}
      </Text>
    </View>
  );
}

export function RenderNode({ node }: { node: UiNode }): ReactNode {
  if (node.type === "Error") return <ErrorLine message={text(node.props.message)} />;
  if (node.type === "Loading") {
    return (
      <LoadingPlaceholder
        path={text(node.props.path)}
        component={typeof node.props.component === "string" ? node.props.component : null}
      />
    );
  }
  if (!renderersMap) return null;
  const Renderer = renderersMap[node.type];
  return <Renderer props={node.props} />;
}

/** Buttons and Other sit together in one wrapping, left-aligned group. */
export function isButtonLike(node: UiNode): boolean {
  return node.type === "Button" || node.type === "Other";
}

export function RenderNodes({
  nodes,
  isolate = false,
}: {
  nodes: readonly UiNode[];
  isolate?: boolean;
}): ReactNode {
  const seen = new Set<string>();
  const out: ReactNode[] = [];
  let run: GroupedButton[] | null = null;
  const Group = buttonGroupComponent;

  nodes.forEach((node, index) => {
    const key = seen.has(node.key) ? `${node.key}@${index}` : node.key;
    seen.add(node.key);
    const element = isolate ? (
      <NodeBoundary key={key} node={node}>
        <RenderNode node={node} />
      </NodeBoundary>
    ) : (
      <RenderNode key={key} node={node} />
    );

    if (!isButtonLike(node) || !Group) {
      run = null;
      out.push(element);
    } else if (run === null) {
      const buttons: GroupedButton[] = [{ key, props: node.props, element }];
      run = buttons;
      out.push(<Group key={`buttons:${key}`} buttons={buttons} />);
    } else {
      run.push({ key, props: node.props, element });
    }
  });

  return <>{out}</>;
}

interface BoundaryProps {
  node: UiNode;
  children: ReactNode;
}

interface BoundaryState {
  error: string | null;
}

/**
 * An error boundary needs `getDerivedStateFromError`, which only a React class
 * component can have. Hermes has no `class` syntax, so this is built on
 * `Component`'s prototype instead (see shared/core/define-class.ts).
 */
const NodeBoundaryBase = defineClass(
  function (this: Component<BoundaryProps, BoundaryState>, props: BoundaryProps): void {
    // React's Component is a plain function underneath; it sets props, context and updater.
    (Component as unknown as (this: unknown, props: BoundaryProps) => void).call(this, props);
    this.state = { error: null };
  },
  {
    componentDidUpdate(previous: BoundaryProps): void {
      if (this.state.error !== null && previous.node !== this.props.node) {
        this.setState({ error: null });
      }
    },

    render(): ReactNode {
      return this.state.error === null ? (
        this.props.children
      ) : (
        <ErrorLine message={this.state.error} />
      );
    },
  },
  Component,
);

export const NodeBoundary = Object.assign(NodeBoundaryBase, {
  getDerivedStateFromError(cause: unknown): BoundaryState {
    return { error: cause instanceof Error ? cause.message : String(cause) };
  },
}) as unknown as ComponentClass<BoundaryProps, BoundaryState>;
