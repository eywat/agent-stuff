import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type, type Static } from "@sinclair/typebox";
import fs from "node:fs/promises";
import path from "node:path";

const DOC_ROOT_DIR = ".pi/doc";

const InfoParamsSchema = Type.Object({
	action: StringEnum(["get", "put"] as const),
	path: Type.String({ description: "Source file path (repo-relative or absolute)" }),
	level: Type.Optional(
		Type.Integer({
			description: "Hierarchy level (default: 1)",
			minimum: 1,
			default: 1,
		}),
	),
	content: Type.Optional(
		Type.String({
			description: "Markdown content to store (required for action=put)",
		}),
	),
	mode: Type.Optional(
		StringEnum(["append", "replace"] as const, {
			description: "Write mode for action=put (default: append)",
			default: "append",
		}),
	),
});

type InfoParams = Static<typeof InfoParamsSchema>;
type InfoAction = InfoParams["action"];
type InfoMode = NonNullable<InfoParams["mode"]>;

function parseInfoParams(params: InfoParams, cwd: string): {
	action: InfoAction;
	relativeSourcePath: string;
	docPath: string;
	docPathRelative: string;
	level: number;
	mode: InfoMode;
	content?: string;
} {
	const mappedPath = mapToDocPath(params.path, cwd);
	const level = validateLevel(params.level);
	const mode: InfoMode = params.mode ?? "append";

	if (params.action === "put" && typeof params.content !== "string") {
		throw new Error("Missing content for put action.");
	}

	return {
		action: params.action,
		relativeSourcePath: mappedPath.relativeSourcePath,
		docPath: mappedPath.docPath,
		docPathRelative: mappedPath.docPathRelative,
		level,
		mode,
		content: params.content,
	};
}

async function runGet(
	relativeSourcePath: string,
	docPath: string,
	docPathRelative: string,
	level: number,
) {
	const existingDoc = await readFileIfExists(docPath);
	if (existingDoc === null) {
		return {
			content: [{ type: "text" as const, text: `No stored knowledge for ${relativeSourcePath}.` }],
			details: {
				action: "get",
				path: relativeSourcePath,
				docPath: docPathRelative,
				level,
				bytesRead: 0,
			},
		};
	}

	const extracted = extractContentUpToLevel(existingDoc, level);
	if (!extracted) {
		return {
			content: [{ type: "text" as const, text: `No stored knowledge for ${relativeSourcePath}.` }],
			details: {
				action: "get",
				path: relativeSourcePath,
				docPath: docPathRelative,
				level,
				bytesRead: Buffer.byteLength(existingDoc, "utf8"),
			},
		};
	}

	return {
		content: [{ type: "text" as const, text: extracted }],
		details: {
			action: "get",
			path: relativeSourcePath,
			docPath: docPathRelative,
			level,
			bytesRead: Buffer.byteLength(existingDoc, "utf8"),
		},
	};
}

async function runPut(
	relativeSourcePath: string,
	docPath: string,
	docPathRelative: string,
	level: number,
	mode: InfoMode,
	content: string,
) {
	const existingDoc = await readFileIfExists(docPath);
	const updatedDoc = upsertManagedLevel(existingDoc ?? "", level, mode, content);
	const created = existingDoc === null;
	const changed = existingDoc !== updatedDoc;
	const bytesRead = existingDoc ? Buffer.byteLength(existingDoc, "utf8") : 0;

	if (changed) {
		await fs.mkdir(path.dirname(docPath), { recursive: true });
		await fs.writeFile(docPath, updatedDoc, "utf8");
	}

	return {
		content: [
			{
				type: "text" as const,
				text: `Stored knowledge for ${relativeSourcePath} at level ${level} (${mode}).`,
			},
		],
		details: {
			action: "put",
			path: relativeSourcePath,
			docPath: docPathRelative,
			level,
			mode,
			created,
			updated: changed,
			bytesRead,
			bytesWritten: changed ? Buffer.byteLength(updatedDoc, "utf8") : 0,
		},
	};
}

export default function infoExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "info",
		label: "Info",
		description:
			"Read and persist repository-local knowledge in .pi/doc/<source-path>.md. " +
			"Use action=get to read (default level=1) and action=put to store stable findings by level.",
		promptSnippet:
			"Repository knowledge base in .pi/doc/<path>.md (use level 1 by default, escalate levels only as needed)",
		promptGuidelines: [
			"For info.get, start with level: 1 and only request higher levels when more detail is needed.",
			"If info.get returns no stored knowledge, read the target source file in the current session and persist findings via info.put.",
			"Use info.put to persist stable repository knowledge after analysis or refactoring.",
			"Map source file paths to .pi/doc/<source-path>.md.",
		],
		parameters: InfoParamsSchema,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const parsed = parseInfoParams(params, ctx.cwd);
			if (parsed.action === "get") {
				return runGet(parsed.relativeSourcePath, parsed.docPath, parsed.docPathRelative, parsed.level);
			}
			return runPut(
				parsed.relativeSourcePath,
				parsed.docPath,
				parsed.docPathRelative,
				parsed.level,
				parsed.mode,
				parsed.content ?? "",
			);
		},
	});
}

function upsertManagedLevel(existingDoc: string, level: number, mode: InfoMode, content: string): string {
	const sections = parseManagedSections(existingDoc);
	const normalizedIncoming = normalizeSectionBody(content);
	const existingLevelBody = sections.get(level) ?? "";

	if (mode === "replace") {
		sections.set(level, normalizedIncoming);
	} else {
		sections.set(level, appendSectionBody(existingLevelBody, normalizedIncoming));
	}

	const maxLevel = Math.max(1, level, ...sections.keys());
	const chunks: string[] = [];
	for (let currentLevel = 1; currentLevel <= maxLevel; currentLevel += 1) {
		const heading = levelToHeading(currentLevel);
		const body = sections.get(currentLevel) ?? "";
		chunks.push(body ? `${heading}\n${body}` : heading);
	}

	return `${chunks.join("\n\n")}\n`;
}

function parseManagedSections(markdown: string): Map<number, string> {
	const sections = new Map<number, string>();
	const lines = normalizeMarkdown(markdown).split("\n");
	let activeLevel: number | null = null;
	let bodyLines: string[] = [];
	let activeFence: FenceState = null;

	const flushSection = () => {
		if (activeLevel === null) return;
		sections.set(activeLevel, normalizeSectionBody(bodyLines.join("\n")));
	};

	for (const line of lines) {
		if (activeFence) {
			if (activeLevel !== null) {
				bodyLines.push(line);
			}
			if (isFenceCloser(line, activeFence)) {
				activeFence = null;
			}
			continue;
		}

		const fenceStart = parseFenceStart(line);
		if (fenceStart) {
			if (activeLevel !== null) {
				bodyLines.push(line);
			}
			activeFence = fenceStart;
			continue;
		}

		const heading = parseHeadingLine(line);
		if (heading) {
			flushSection();
			activeLevel = headingToManagedLevel(heading.depth, heading.title);
			bodyLines = [];
			continue;
		}

		if (activeLevel !== null) {
			bodyLines.push(line);
		}
	}

	flushSection();
	return sections;
}

function extractContentUpToLevel(markdown: string, level: number): string {
	const sections = parseMarkdownSections(markdown);
	const contentBlocks = sections
		.filter((section) => section.depth <= level)
		.map((section) => normalizeSectionBody(section.body))
		.filter(Boolean);
	return contentBlocks.join("\n\n");
}

type MarkdownSection = { depth: number; body: string };
type FenceState = { marker: "`" | "~"; width: number } | null;

function parseMarkdownSections(markdown: string): MarkdownSection[] {
	const lines = normalizeMarkdown(markdown).split("\n");
	const sections: MarkdownSection[] = [];
	let currentDepth = 1;
	let currentBody: string[] = [];
	let activeFence: FenceState = null;

	const flushSection = () => {
		sections.push({ depth: currentDepth, body: currentBody.join("\n") });
	};

	for (const line of lines) {
		if (activeFence) {
			currentBody.push(line);
			if (isFenceCloser(line, activeFence)) {
				activeFence = null;
			}
			continue;
		}

		const fenceStart = parseFenceStart(line);
		if (fenceStart) {
			currentBody.push(line);
			activeFence = fenceStart;
			continue;
		}

		const heading = parseHeadingLine(line);
		if (heading) {
			flushSection();
			currentDepth = heading.depth;
			currentBody = [];
			continue;
		}

		currentBody.push(line);
	}

	flushSection();
	return sections;
}

function appendSectionBody(existingBody: string, incomingBody: string): string {
	const left = normalizeSectionBody(existingBody);
	const right = normalizeSectionBody(incomingBody);
	if (!right) return left;
	if (!left) return right;
	return `${left}\n\n${right}`;
}

function headingToManagedLevel(depth: number, title: string): number | null {
	const normalized = title.trim();
	if (depth === 1 && normalized.toLowerCase() === "info") return 1;
	if (depth > 1 && normalized.toLowerCase() === `level ${depth}`) return depth;
	return null;
}

function levelToHeading(level: number): string {
	if (level === 1) return "# Info";
	return `${"#".repeat(level)} Level ${level}`;
}

function parseHeadingLine(line: string): { depth: number; title: string } | null {
	const match = line.match(/^(?: {0,3})(#{1,6})[ \t]+(.+?)(?:[ \t]+#+[ \t]*)?$/);
	if (!match) return null;
	return { depth: match[1].length, title: match[2].trim() };
}

function parseFenceStart(line: string): Exclude<FenceState, null> | null {
	const match = line.match(/^(?: {0,3})(`{3,}|~{3,})/);
	if (!match) return null;
	const marker = match[1][0] as "`" | "~";
	return { marker, width: match[1].length };
}

function isFenceCloser(line: string, fence: Exclude<FenceState, null>): boolean {
	const pattern = new RegExp(`^(?: {0,3})${fence.marker}{${fence.width},}[ \t]*$`);
	return pattern.test(line);
}

function mapToDocPath(inputPath: string, cwd: string): {
	relativeSourcePath: string;
	docPath: string;
	docPathRelative: string;
} {
	const cleanedPath = normalizePathInput(inputPath);
	if (!cleanedPath) throw new Error("Invalid path.");

	const repoRoot = path.resolve(cwd);
	const absolutePath = resolveSourcePath(cleanedPath, repoRoot);
	const relativeSourcePath = toRepoRelativePath(absolutePath, repoRoot, inputPath);
	const docPathRelative = toDocPathRelative(relativeSourcePath);
	const docPath = path.join(repoRoot, docPathRelative);

	return {
		relativeSourcePath,
		docPath,
		docPathRelative,
	};
}

function normalizePathInput(rawPath: string): string {
	let normalized = rawPath.trim();
	while (normalized.startsWith("@")) normalized = normalized.slice(1);
	normalized = normalized.trim();
	return normalized.replace(/[\\/]+/g, path.sep);
}

function resolveSourcePath(sourcePath: string, repoRoot: string): string {
	if (path.isAbsolute(sourcePath)) return path.resolve(sourcePath);
	return path.resolve(repoRoot, sourcePath);
}

function toRepoRelativePath(absolutePath: string, repoRoot: string, inputPath: string): string {
	const relativePath = path.relative(repoRoot, absolutePath);
	const isOutsideRepo = relativePath === ".." || relativePath.startsWith(`..${path.sep}`);
	if (!relativePath || isOutsideRepo || path.isAbsolute(relativePath)) {
		throw new Error(`Path escapes repository root: ${inputPath}`);
	}
	return relativePath.split(/[\\/]+/).join("/");
}

function toDocPathRelative(relativeSourcePath: string): string {
	return path.posix.join(DOC_ROOT_DIR, `${relativeSourcePath}.md`);
}

function validateLevel(level: number | undefined): number {
	if (level === undefined) return 1;
	if (!Number.isInteger(level) || level < 1) {
		throw new Error("Invalid level. Expected an integer >= 1.");
	}
	return level;
}

function normalizeMarkdown(markdown: string): string {
	return markdown.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function normalizeSectionBody(body: string): string {
	return body.trim().replace(/\n{3,}/g, "\n\n");
}

async function readFileIfExists(filePath: string): Promise<string | null> {
	try {
		return await fs.readFile(filePath, "utf8");
	} catch (error: any) {
		if (error?.code === "ENOENT") return null;
		throw error;
	}
}
