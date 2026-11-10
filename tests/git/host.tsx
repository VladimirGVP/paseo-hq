import { useMemo } from "react";
export const toast = { show() {}, error() {} };
export const useToast = () => toast;
export const useRpc = (contract: { name: string }) => useMemo(() => async (input: unknown) => {
  const response = await fetch("/rpc", { method: "POST", body: JSON.stringify({ method: contract.name, input }) });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}, [contract.name]);
export const useSettings = () => ({ status: "ready", values: { gitlabUrl: "https://gitlab.com", cloneDir: "~/repos", cloneProtocol: "https", githubCloneProtocol: "https", defaultIsolation: "local" }, revision: "1", save: async () => {} });
export const copyText = async (value: string) => { document.body.dataset.copied = value; };
export const openExternalUrl = async (value: string) => { document.body.dataset.opened = value; };
