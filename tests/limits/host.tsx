import { useMemo } from "react";

export const useRpc = (contract: { name: string }) => useMemo(() => async (input: unknown) => {
  const response = await fetch("/rpc", { method: "POST", body: JSON.stringify({ method: contract.name, input }) });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}, [contract.name]);

export const openExternalUrl = async (url: string) => { document.body.dataset.opened = url; };
