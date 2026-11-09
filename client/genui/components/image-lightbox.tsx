// Modified by GNATOVSKIE for integration into Paseo HQ, 2026-11-10.
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { clampZoom, wheelFactor, zoomAt, type LightboxView } from "../../../shared/genui/logic/lightbox";

type PointerLike = { clientX: number; clientY: number; button: number };
type WheelLike = { clientX: number; clientY: number; deltaY: number; deltaMode: number; ctrlKey: boolean; preventDefault(): void };
/** The DOM node react-native-web hands back as a View ref; the plugin has no DOM lib types. */
type StageNode = {
  addEventListener(type: string, listener: (event: never) => void, options?: { passive: boolean }): void;
  removeEventListener(type: string, listener: (event: never) => void): void;
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
};

/**
 * A fullscreen image viewer, like the one Paseo uses for chat images. The plugin
 * SDK exposes no call to open the host's, so this is built on React Native's Modal,
 * which covers the whole window. On web, scroll or pinch zooms at the cursor and
 * dragging moves the image; click the image to switch between fit and actual size.
 */
export function ImageLightbox({
  uri,
  title,
  onClose,
}: {
  uri: string;
  title: string;
  onClose(): void;
}) {
  const web = Platform.OS === "web";
  const viewport = useWindowDimensions();
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [actual, setActual] = useState(false);
  const [stage, setStage] = useState<{ width: number; height: number } | null>(null);
  const [view, setView] = useState<LightboxView | null>(null);
  const stageRef = useRef<View>(null);
  const moved = useRef(false);

  useEffect(() => {
    let live = true;
    Image.getSize(
      uri,
      (width, height) => {
        if (live) setNatural({ width, height });
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [uri]);

  const stageWidth = stage?.width ?? viewport.width;
  const stageHeight = stage?.height ?? Math.max(200, viewport.height - 96);
  const fit = natural === null ? 1 : Math.min(stageWidth / natural.width, stageHeight / natural.height, 1);
  const zoomable = natural !== null && fit < 1;
  const current = view ?? { zoom: fit, x: 0, y: 0 };
  const scale = web ? current.zoom : actual ? 1 : fit;
  const shown = natural === null ? null : { width: natural.width * scale, height: natural.height * scale };

  const latest = useRef({ current, fit });
  useLayoutEffect(() => {
    latest.current = { current, fit };
  });

  useEffect(() => {
    const node = stageRef.current as unknown as StageNode | null;
    if (!web || natural === null || node === null) return;
    const fromCentre = (e: { clientX: number; clientY: number }) => {
      const r = node.getBoundingClientRect();
      return { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 };
    };
    let drag: { px: number; py: number; x: number; y: number } | null = null;
    const onWheel = (e: WheelLike) => {
      e.preventDefault();
      const { current: now, fit: f } = latest.current;
      setView(zoomAt(now, wheelFactor(e.deltaY, e.ctrlKey, e.deltaMode), fromCentre(e), f));
    };
    const onDown = (e: PointerLike) => {
      if (e.button !== 0) return;
      moved.current = false;
      const { x, y } = latest.current.current;
      drag = { px: e.clientX, py: e.clientY, x, y };
    };
    const onMove = (e: PointerLike) => {
      if (drag === null) return;
      const dx = e.clientX - drag.px;
      const dy = e.clientY - drag.py;
      if (!moved.current && Math.hypot(dx, dy) < 4) return;
      moved.current = true;
      const { current: now, fit: f } = latest.current;
      if (now.zoom > f) setView({ zoom: now.zoom, x: drag.x + dx, y: drag.y + dy });
    };
    const onUp = () => {
      drag = null;
    };
    const noDrag = (e: { preventDefault(): void }) => e.preventDefault();
    node.addEventListener("wheel", onWheel, { passive: false });
    node.addEventListener("pointerdown", onDown);
    node.addEventListener("pointermove", onMove);
    node.addEventListener("pointerup", onUp);
    node.addEventListener("pointerleave", onUp);
    node.addEventListener("dragstart", noDrag);
    return () => {
      node.removeEventListener("wheel", onWheel);
      node.removeEventListener("pointerdown", onDown);
      node.removeEventListener("pointermove", onMove);
      node.removeEventListener("pointerup", onUp);
      node.removeEventListener("pointerleave", onUp);
      node.removeEventListener("dragstart", noDrag);
    };
  }, [web, natural]);

  // A press that ended a drag is not a click.
  const closeFromStage = () => {
    if (!moved.current) onClose();
  };
  const toggleWeb = () => {
    if (moved.current || natural === null) return;
    setView(current.zoom > fit + 1e-3 ? null : zoomable ? { zoom: clampZoom(1, fit), x: 0, y: 0 } : view);
  };

  const hint = web
    ? `Scroll to zoom${current.zoom > fit ? " · drag to move" : ""}${zoomable ? " · click for 100%" : ""} · Esc to close`
    : zoomable
      ? actual
        ? "Tap to fit"
        : "Tap to zoom"
      : "";

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={styles.header}>
          <Text numberOfLines={1} style={styles.title}>
            {title}
            {natural !== null ? `   ${natural.width} × ${natural.height}` : ""}
          </Text>
          {natural !== null ? <Text style={styles.percent}>{Math.round(scale * 100)}%</Text> : null}
          <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={16} onPress={onClose} style={styles.close}>
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
        </View>
        {web ? (
          <View
            ref={stageRef}
            style={styles.webStage}
            onLayout={(e) => setStage({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
          >
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={closeFromStage} style={StyleSheet.absoluteFill} />
            {shown !== null ? (
              <Pressable
                accessibilityRole="imagebutton"
                accessibilityLabel={title}
                onPress={toggleWeb}
                style={{
                  position: "absolute",
                  left: (stageWidth - shown.width) / 2 + current.x,
                  top: (stageHeight - shown.height) / 2 + current.y,
                  cursor: current.zoom > fit ? "grab" : zoomable ? "zoom-in" : "default",
                } as never}
              >
                <Image source={{ uri }} resizeMode="contain" style={shown} />
              </Pressable>
            ) : (
              <Text style={[styles.percent, styles.loading]}>Loading…</Text>
            )}
          </View>
        ) : (
          <ScrollView
            style={styles.stage}
            contentContainerStyle={{ minHeight: stageHeight, minWidth: stageWidth, alignItems: "center", justifyContent: "center" }}
            horizontal={actual}
            maximumZoomScale={4}
            centerContent
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onClose}
              style={{ minHeight: stageHeight, minWidth: stageWidth }}
            >
              <ScrollView
                contentContainerStyle={{ minHeight: stageHeight, justifyContent: "center", alignItems: "center" }}
                scrollEnabled={actual}
              >
                <Pressable
                  accessibilityRole="imagebutton"
                  accessibilityLabel={zoomable ? (actual ? "Fit to window" : "Show actual size") : title}
                  onPress={() => {
                    if (zoomable) setActual((value) => !value);
                  }}
                >
                  {shown !== null ? (
                    <Image source={{ uri }} resizeMode="contain" style={shown} />
                  ) : (
                    <Text style={styles.percent}>Loading…</Text>
                  )}
                </Pressable>
              </ScrollView>
            </Pressable>
          </ScrollView>
        )}
        <Text style={styles.hint}>{hint}</Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.94)" },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  title: { flex: 1, color: "#f4f4f5", fontSize: 13, fontWeight: "600" },
  percent: { color: "#a1a1aa", fontSize: 12 },
  loading: { textAlign: "center", marginTop: 40 },
  close: { paddingHorizontal: 14, paddingVertical: 8 },
  closeText: { color: "#f4f4f5", fontSize: 24 },
  stage: { flex: 1 },
  webStage: { flex: 1, overflow: "hidden" },
  hint: { color: "#a1a1aa", fontSize: 12, textAlign: "center", paddingVertical: 8 },
});
