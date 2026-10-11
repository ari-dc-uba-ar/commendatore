// Forma común de armar la línea de comandos de las herramientas: nombre y versión tomados del package.json,
// la versión en la primera línea de la salida, los códigos de salida en la ayuda y flags estrictos.
// Es parte de la capa de línea de comandos (los módulos *-cli), por eso usa cleye y process.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export { cli, command } from 'cleye';
export type { Command, Flags } from 'cleye';

/** Un código de salida del comando y qué significa; se lista en la ayuda. */
export interface ExitCode {
    code: number;
    description: string;
}

/** Nombre y versión del paquete al que pertenece el comando. */
export interface PackageIdentity {
    name: string;
    version: string;
}

/** Lo que commendatore agrega a la definición de cleye. Se esparce dentro del objeto que recibe `cli`. */
export interface BaseCliOptions {
    name: string;
    version: string;
    strictFlags: true;
    help: {
        description: string;
        examples: string[];
    };
}

export interface CommandLineDefinition {
    /** `import.meta.url` del módulo -cli: el package.json del paquete se busca subiendo desde su carpeta. */
    moduleUrl: string;
    /** Qué hace el comando; encabeza la ayuda. */
    description: string;
    examples: string[];
    exitCodes: readonly ExitCode[];
}

/** Cómo se escribe la línea con la versión. Va aparte de la definición para que sus tipos salgan de lo que interpretó cleye. */
export interface VersionLineOptions<Parsed> {
    /** Si se indica y devuelve false, no se escribe la línea con la versión (por ejemplo, cuando la salida es JSON). */
    show?: (parsed: Parsed) => boolean;
    /** Dónde se escribe; por omisión, la salida estándar. */
    write?: (text: string) => void;
}

/** Lo que devuelve `parseCommandLine`: lo interpretado por cleye y la identidad del paquete. */
export interface CommandLine<Parsed> {
    parsed: Parsed;
    identity: PackageIdentity;
}

/**
 * @param value lo leído del package.json
 * @param file ruta del package.json, para los mensajes de error
 */
function toPackageIdentity(value: unknown, file: string): PackageIdentity {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${file} no contiene un objeto`);
    if (!('name' in value) || typeof value.name !== 'string' || value.name === '') throw new Error(`${file} no tiene "name"`);
    if (!('version' in value) || typeof value.version !== 'string' || value.version === '') throw new Error(`${file} no tiene "version"`);
    return { name: value.name, version: value.version };
}

/** Nombre y versión del primer package.json que se encuentra subiendo desde la carpeta del módulo indicado. */
export function readPackageIdentity(moduleUrl: string): PackageIdentity {
    let dir = dirname(fileURLToPath(moduleUrl));
    while (!existsSync(join(dir, 'package.json'))) {
        const parent = dirname(dir);
        if (parent === dir) throw new Error(`No hay package.json en las carpetas que contienen a ${fileURLToPath(moduleUrl).replaceAll('\\', '/')}`);
        dir = parent;
    }
    const file = join(dir, 'package.json');
    return toPackageIdentity(JSON.parse(readFileSync(file, 'utf8')), file.replaceAll('\\', '/'));
}

/** Línea que identifica al comando y su versión; es la primera línea de la salida. */
export function versionLine(identity: PackageIdentity): string {
    return `${identity.name} v${identity.version}`;
}

/** Descripción para la ayuda: el texto del comando seguido de la lista de códigos de salida. */
export function helpDescription(description: string, exitCodes: readonly ExitCode[]): string {
    return [
        description,
        '',
        'Códigos de salida:',
        ...exitCodes.map(function (exitCode) { return `  ${exitCode.code}  ${exitCode.description}`; }),
    ].join('\n');
}

/**
 * Interpreta la línea de comandos. `parse` recibe las opciones comunes (nombre, versión, flags estrictos y ayuda)
 * y llama a `cli` agregando los parámetros y flags propios del comando; así cleye infiere los tipos de lo interpretado.
 * cleye muestra la ayuda o la versión y termina el proceso ante `--help`, `--version` o un flag desconocido;
 * en los demás casos se escribe la línea con la versión, salvo que `versionLineOptions.show` diga lo contrario.
 */
export function parseCommandLine<Parsed>(
    definition: CommandLineDefinition,
    parse: (base: BaseCliOptions) => Parsed,
    versionLineOptions: VersionLineOptions<Parsed> = {},
): CommandLine<Parsed> {
    const identity = readPackageIdentity(definition.moduleUrl);
    const parsed = parse({
        name: identity.name,
        version: identity.version,
        strictFlags: true,
        help: {
            description: helpDescription(definition.description, definition.exitCodes),
            examples: definition.examples,
        },
    });
    if (versionLineOptions.show === undefined || versionLineOptions.show(parsed)) {
        const write = versionLineOptions.write ?? function (text: string) { process.stdout.write(text); };
        write(versionLine(identity) + '\n');
    }
    return { parsed, identity };
}

/**
 * Ejecuta `main` y fija el código de salida con lo que devuelve. Un error que `main` no atrapó es un defecto:
 * se muestra con su stack y el código de salida es `unexpectedErrorCode`.
 */
export function runMain(main: () => Promise<number>, unexpectedErrorCode: number): void {
    main().then(function (code) { process.exitCode = code; }, function (err: unknown) {
        process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
        process.exitCode = unexpectedErrorCode;
    });
}
