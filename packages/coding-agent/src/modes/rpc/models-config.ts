import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Api, Model } from "@mariozechner/pi-ai";
import { getModelsPath } from "../../config.js";

export interface RpcProviderConfig {
	baseUrl?: string;
	apiKey?: string;
	api?: string;
	headers?: Record<string, string>;
	authHeader?: boolean;
	compat?: Record<string, unknown>;
	models?: RpcModelConfig[];
	modelOverrides?: Record<string, Record<string, unknown>>;
}

export interface RpcModelConfig {
	id: string;
	name?: string;
	api?: string;
	baseUrl?: string;
	reasoning?: boolean;
	input?: Array<"text" | "image">;
	cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
	contextWindow?: number;
	maxTokens?: number;
	headers?: Record<string, string>;
	compat?: Record<string, unknown>;
}

export interface RpcModelsConfig {
	providers: Record<string, RpcProviderConfig>;
}

export interface UpsertProviderConfigPayload {
	provider: string;
	config: RpcProviderConfig;
}

export interface UpsertModelConfigPayload {
	provider: string;
	model: RpcModelConfig;
}

function normalizeConfig(config: RpcModelsConfig | undefined): RpcModelsConfig {
	return { providers: config?.providers ?? {} };
}

function cleanObject<T extends Record<string, unknown>>(value: T): T {
	return Object.fromEntries(Object.entries(value).filter(([, fieldValue]) => fieldValue !== undefined)) as T;
}

function cleanProviderConfig(config: RpcProviderConfig): RpcProviderConfig {
	return cleanObject({
		baseUrl: config.baseUrl,
		apiKey: config.apiKey,
		api: config.api,
		headers: config.headers && Object.keys(config.headers).length > 0 ? config.headers : undefined,
		authHeader: config.authHeader,
		compat: config.compat && Object.keys(config.compat).length > 0 ? config.compat : undefined,
		models: config.models,
		modelOverrides: config.modelOverrides,
	});
}

function cleanModelConfig(model: RpcModelConfig): RpcModelConfig {
	return cleanObject({
		id: model.id,
		name: model.name,
		api: model.api,
		baseUrl: model.baseUrl,
		reasoning: model.reasoning,
		input: model.input && model.input.length > 0 ? model.input : undefined,
		cost: model.cost && Object.keys(model.cost).length > 0 ? model.cost : undefined,
		contextWindow: model.contextWindow,
		maxTokens: model.maxTokens,
		headers: model.headers && Object.keys(model.headers).length > 0 ? model.headers : undefined,
		compat: model.compat && Object.keys(model.compat).length > 0 ? model.compat : undefined,
	});
}

export function readModelsConfig(modelsPath: string = getModelsPath()): RpcModelsConfig {
	if (!existsSync(modelsPath)) {
		return { providers: {} };
	}
	const content = readFileSync(modelsPath, "utf-8");
	return normalizeConfig(JSON.parse(content) as RpcModelsConfig);
}

export function writeModelsConfig(config: RpcModelsConfig, modelsPath: string = getModelsPath()): void {
	const dir = dirname(modelsPath);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	writeFileSync(modelsPath, `${JSON.stringify(normalizeConfig(config), null, 2)}\n`, "utf-8");
}

export function upsertProviderConfig(
	payload: UpsertProviderConfigPayload,
	modelsPath: string = getModelsPath(),
): RpcModelsConfig {
	const config = readModelsConfig(modelsPath);
	const existing = config.providers[payload.provider] ?? {};
	config.providers[payload.provider] = cleanProviderConfig({
		...existing,
		...payload.config,
		models: existing.models,
		modelOverrides: existing.modelOverrides,
	});
	writeModelsConfig(config, modelsPath);
	return config;
}

export function deleteProviderConfig(provider: string, modelsPath: string = getModelsPath()): RpcModelsConfig {
	const config = readModelsConfig(modelsPath);
	delete config.providers[provider];
	writeModelsConfig(config, modelsPath);
	return config;
}

export function upsertModelConfig(
	payload: UpsertModelConfigPayload,
	modelsPath: string = getModelsPath(),
): RpcModelsConfig {
	const config = readModelsConfig(modelsPath);
	const providerConfig = config.providers[payload.provider] ?? {};
	const existingModels = Array.isArray(providerConfig.models) ? providerConfig.models : [];
	config.providers[payload.provider] = cleanProviderConfig({
		...providerConfig,
		models: [...existingModels.filter((model) => model.id !== payload.model.id), cleanModelConfig(payload.model)],
	});
	writeModelsConfig(config, modelsPath);
	return config;
}

export function deleteModelConfig(
	provider: string,
	modelId: string,
	modelsPath: string = getModelsPath(),
): RpcModelsConfig {
	const config = readModelsConfig(modelsPath);
	const providerConfig = config.providers[provider];
	if (!providerConfig || !Array.isArray(providerConfig.models)) {
		return config;
	}
	config.providers[provider] = cleanProviderConfig({
		...providerConfig,
		models: providerConfig.models.filter((model) => model.id !== modelId),
	});
	writeModelsConfig(config, modelsPath);
	return config;
}

export function modelToRpcModelConfig(model: Model<Api>): RpcModelConfig {
	return cleanModelConfig({
		id: model.id,
		name: model.name,
		api: model.api,
		baseUrl: model.baseUrl,
		reasoning: model.reasoning,
		input: model.input,
		cost: model.cost,
		contextWindow: model.contextWindow,
		maxTokens: model.maxTokens,
		headers: model.headers,
		compat: model.compat as Record<string, unknown> | undefined,
	});
}
