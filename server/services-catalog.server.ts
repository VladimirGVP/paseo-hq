import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type ServicesMap = Record<string, [string, string]>;

export const DEFAULT_EXAMPLE_SERVICES: ServicesMap = {
  "docker.service": ["Docker", "Демон управления контейнерами"],
  "nginx.service": ["Nginx", "Веб-сервер и обратный прокси"],
  "ssh.service": ["SSH", "Служба защищенного удаленного доступа"],
};

export function loadCatalog(): ServicesMap {
  const customPath = process.env.PASEO_SERVICES_CONFIG || join(homedir(), ".paseo", "services.json");
  if (existsSync(customPath)) {
    try {
      const data = JSON.parse(readFileSync(customPath, "utf8"));
      if (typeof data === "object" && data !== null) {
        return data as ServicesMap;
      }
    } catch {
      // fallback
    }
  }
  return DEFAULT_EXAMPLE_SERVICES;
}

export const catalog: ServicesMap = loadCatalog();
