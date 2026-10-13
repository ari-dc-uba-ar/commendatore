// Common way to build the command line of the tools (the *-cli modules), on top of cleye.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import type { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

export { cli, command } from 'cleye';
export type { Command, Flags } from 'cleye';

/** English is the base and defines the keys; in the other languages a missing message is shown in English. */
export interface I18n<Messages extends Record<string, string>> {
    messages: {
        en: Messages;
        [lang: string]: Partial<Messages>;
    };
}

export const messages = {
    exitCodes: 'Exit codes:',
    langFlagDescription: 'Language of the messages (by default, detected from the environment)',
    langFlagNeedsValue: '--lang needs a language, i.e. --lang=es',
    noPackageJsonInFoldersContaining1: 'There is no package.json in the folders that contain $1',
    file1IsNotAnObject: '$1 does not contain an object',
    file1LacksName: '$1 has no "name"',
    file1LacksVersion: '$1 has no "version"',
};

export const i18n: I18n<typeof messages> = {
    messages: {
        en: messages,
        es: {
            exitCodes: 'Exit codes:', // suena más natural que su traducción al castellano.
            langFlagDescription: 'Idioma de los mensajes (por omisión, se detecta del entorno)',
            langFlagNeedsValue: '--lang necesita un idioma, por ejemplo --lang=es',
            noPackageJsonInFoldersContaining1: 'No hay package.json en las carpetas que contienen a $1',
            file1IsNotAnObject: '$1 no contiene un objeto',
            file1LacksName: '$1 no tiene "name"',
            file1LacksVersion: '$1 no tiene "version"',
        },
        it: {
            langFlagDescription: "Lingua dei messaggi (per impostazione predefinita, rilevata dall'ambiente)",
            langFlagNeedsValue: '--lang richiede una lingua, ad esempio --lang=it',
            noPackageJsonInFoldersContaining1: "Non c'è nessun package.json nelle cartelle che contengono $1",
            file1IsNotAnObject: '$1 non contiene un oggetto',
            file1LacksName: '$1 non ha "name"',
            file1LacksVersion: '$1 non ha "version"',
        },
    },
};

/** `es_AR.UTF-8` -> `es`; undefined for empty, `C` or `POSIX`. */
function languageOf(locale: string | undefined): string | undefined {
    const match = /^([a-z]{2,3})(?:[-_.@]|$)/i.exec(locale ?? '');
    return match?.[1]?.toLowerCase();
}

/** `explicit`, else `LANGUAGE`, `LC_ALL`, `LC_MESSAGES`, `LANG`, else the system locale reported by Node, else English. */
export function detectLanguage(
    explicit?: string,
    env: Record<string, string | undefined> = process.env,
    systemLocale: string = new Intl.DateTimeFormat().resolvedOptions().locale,
): string {
    const candidates = [explicit, ...(env['LANGUAGE'] ?? '').split(':'), env['LC_ALL'], env['LC_MESSAGES'], env['LANG'], systemLocale];
    for (const candidate of candidates) {
        const lang = languageOf(candidate);
        if (lang !== undefined) return lang;
    }
    return 'en';
}

export function translator<Messages extends Record<string, string>>(
    i18nOfModule: I18n<Messages>,
    lang: string,
): (key: keyof Messages & string, ...params: (string | number)[]) => string {
    const dictionary = i18nOfModule.messages[lang];
    return function message(key, ...params) {
        const text = dictionary?.[key] ?? i18nOfModule.messages.en[key];
        return text.replace(/\$(\d+)/g, function (_placeholder, position: string) {
            const value = params[Number(position) - 1];
            if (value === undefined) throw new Error(`missing parameter $${position} of the message "${key}"`);
            return String(value);
        });
    };
}

export interface ExitCode {
    code: number;
    description: string;
}

export interface PackageIdentity {
    name: string;
    version: string;
}

/**
 * Spread inside the object passed to `cli`. A tool that declares its own flags, or commands, must also spread
 * `base.flags` in them (`flags: { ...base.flags, ... }`): that is how cleye knows `--lang`.
 */
export interface BaseCliOptions {
    name: string;
    version: string;
    strictFlags: true;
    flags: {
        lang: { type: StringConstructor; description: string; placeholder: string };
    };
    help: {
        description: string;
        examples: string[];
    };
}

/** A help text that may depend on the language of the messages. */
export type Localized<T> = T | ((lang: string) => T);

export interface CommandLineDefinition {
    /** `import.meta.url` of the -cli module: package.json is searched upwards from its folder. */
    moduleUrl: string;
    description: Localized<string>;
    examples: Localized<string[]>;
    /** Omitted when the meaning is the usual one (0 = ok, other = error). */
    exitCodes?: Localized<readonly ExitCode[]>;
    argv: readonly string[];
}

function localize<T>(value: Localized<T>, lang: string): T {
    return value instanceof Function ? value(lang) : value;
}

export interface VersionLineOptions<Parsed> {
    /** Returning false omits the version line (i.e. when the output is JSON). */
    show?: (parsed: Parsed) => boolean;
    write?: (text: string) => void;
}

export interface CommandLine<Parsed> {
    parsed: Parsed;
    identity: PackageIdentity;
    lang: string;
}

/** A mistake in the command line typed by the user (not a defect): reported in one line, like cleye does. */
export class CommandLineError extends Error {}

/**
 * The value of `--lang` read before cleye parses, only to choose the language of the help cleye may print.
 * The flag itself is declared, validated and listed by cleye.
 */
export function readLangFlag(argv: readonly string[], lang: string = detectLanguage()): string | undefined {
    let found: string | undefined;
    for (let i = 0; i < argv.length && argv[i] !== '--'; i++) {
        const arg = argv[i] ?? '';
        if (arg !== '--lang' && !arg.startsWith('--lang=')) continue;
        found = arg === '--lang' ? argv[++i] : arg.slice('--lang='.length);
        if (found === undefined || found === '' || found.startsWith('-')) throw new CommandLineError(translator(i18n, lang)('langFlagNeedsValue'));
    }
    return found;
}

/** @param file path of package.json, for the error messages */
function toPackageIdentity(value: unknown, file: string, lang: string): PackageIdentity {
    const message = translator(i18n, lang);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(message('file1IsNotAnObject', file));
    if (!('name' in value) || typeof value.name !== 'string' || value.name === '') throw new Error(message('file1LacksName', file));
    if (!('version' in value) || typeof value.version !== 'string' || value.version === '') throw new Error(message('file1LacksVersion', file));
    return { name: value.name, version: value.version };
}

/** From the first package.json found going up from the folder of the module. */
export function readPackageIdentity(moduleUrl: string, lang: string = detectLanguage()): PackageIdentity {
    let dir = dirname(fileURLToPath(moduleUrl));
    while (!existsSync(join(dir, 'package.json'))) {
        const parent = dirname(dir);
        if (parent === dir) throw new Error(translator(i18n, lang)('noPackageJsonInFoldersContaining1', fileURLToPath(moduleUrl).replaceAll('\\', '/')));
        dir = parent;
    }
    const file = join(dir, 'package.json');
    return toPackageIdentity(JSON.parse(readFileSync(file, 'utf8')), file.replaceAll('\\', '/'), lang);
}

export function versionLine(identity: PackageIdentity): string {
    return `${identity.name} v${identity.version}`;
}

export function helpDescription(description: string, exitCodes: readonly ExitCode[], lang: string = detectLanguage()): string {
    if (exitCodes.length === 0) return description;
    return [
        description,
        '',
        translator(i18n, lang)('exitCodes'),
        ...exitCodes.map(function (exitCode) { return `  ${exitCode.code}  ${exitCode.description}`; }),
    ].join('\n');
}

/**
 * `parse` calls `cli` with the base options (spread) and the tool's own parameters and flags, so cleye infers
 * the types; it receives `lang` to localize the help of its commands and flags.
 * cleye shows the help or the version and ends the process on `--help`, `--version` or an unknown flag;
 * otherwise the version line is written, unless `versionLineOptions.show` says otherwise.
 */
export function parseCommandLine<Parsed>(
    definition: CommandLineDefinition,
    parse: (base: BaseCliOptions, argv: string[], lang: string) => Parsed,
    versionLineOptions: VersionLineOptions<Parsed> = {},
): CommandLine<Parsed> {
    let langFlag: string | undefined;
    try {
        langFlag = readLangFlag(definition.argv);
    } catch (err) {
        if (!(err instanceof CommandLineError)) throw err;
        process.stderr.write(`Error: ${err.message}\n`);
        process.exit(1);
    }
    const lang = detectLanguage(langFlag);
    const identity = readPackageIdentity(definition.moduleUrl, lang);
    const parsed = parse({
        name: identity.name,
        version: identity.version,
        strictFlags: true,
        flags: {
            lang: { type: String, description: translator(i18n, lang)('langFlagDescription'), placeholder: '<lang>' },
        },
        help: {
            description: helpDescription(localize(definition.description, lang), localize(definition.exitCodes ?? [], lang), lang),
            examples: localize(definition.examples, lang),
        },
    }, [...definition.argv], lang);
    if (versionLineOptions.show === undefined || versionLineOptions.show(parsed)) {
        const write = versionLineOptions.write ?? function (text: string) { process.stdout.write(text); };
        write(versionLine(identity) + '\n');
    }
    return { parsed, identity, lang };
}

export interface Confirmation {
    confirmed: boolean;
    /** `disabled`: the command line said no; `needs-tty`: it had to ask but there is no terminal. */
    reason?: 'declined' | 'disabled' | 'needs-tty';
}

export interface ConfirmerOptions {
    /** true = yes to all, false = no to all, undefined = ask. */
    decision: boolean | undefined;
    /** The item and the choices are appended, i.e. `delete file.txt [y/N] `. */
    question: string;
    /** Offers `a`: yes to this one and all the following. */
    allowAll?: boolean;
    /** Without `isTTY` it does not ask. */
    input?: Readable & { isTTY?: boolean };
    output?: Writable;
}

/**
 * Answers: `y` or `s` = yes; `a` (with `allowAll`) = yes to this one and all the following; anything else = no.
 * It only writes the question: reporting what was not done is up to each tool.
 */
export function createConfirmer(options: ConfirmerOptions): (subject: string) => Promise<Confirmation> {
    let all = options.decision === true;
    const input = options.input ?? process.stdin;
    const output = options.output ?? process.stdout;
    const choices = options.allowAll === true ? '[y/N/a]' : '[y/N]';
    return async function confirm(subject: string): Promise<Confirmation> {
        if (all) return { confirmed: true };
        if (options.decision === false) return { confirmed: false, reason: 'disabled' };
        if (input.isTTY !== true) return { confirmed: false, reason: 'needs-tty' };
        const readline = createInterface({ input, output });
        try {
            const answer = await readline.question(`${options.question} ${subject} ${choices} `);
            if (options.allowAll === true && /^\s*a/i.test(answer)) {
                all = true;
                return { confirmed: true };
            }
            return /^\s*[ys]/i.test(answer) ? { confirmed: true } : { confirmed: false, reason: 'declined' };
        } finally {
            readline.close();
        }
    };
}

/** An error `main` did not catch is a defect: it is shown with its stack and the exit code is `unexpectedErrorCode`. */
export function runMain(main: () => Promise<number>, unexpectedErrorCode: number): void {
    main().then(function (code) { process.exitCode = code; }, function (err: unknown) {
        process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
        process.exitCode = unexpectedErrorCode;
    });
}
