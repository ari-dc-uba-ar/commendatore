import { strict as assert } from 'node:assert';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cli, command, helpDescription, parseCommandLine, readPackageIdentity, versionLine } from '../src/commendatore.js';
import type { ExitCode } from '../src/commendatore.js';

const EXIT_CODES: ExitCode[] = [
    { code: 0, description: 'todo bien' },
    { code: 3, description: 'error de configuración' },
];

/** Crea un paquete de prueba con un módulo en bin/ y devuelve la URL de ese módulo. */
async function fakePackage(packageJson: unknown): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'commendatore-'));
    await mkdir(join(dir, 'bin'));
    await writeFile(join(dir, 'package.json'), JSON.stringify(packageJson));
    return pathToFileURL(join(dir, 'bin', 'mi-tool-cli.js')).href;
}

describe('commendatore', function () {
    describe('readPackageIdentity', function () {
        it('lee nombre y versión del package.json subiendo desde la carpeta del módulo', async function () {
            const moduleUrl = await fakePackage({ name: 'mi-tool', version: '1.2.3' });
            assert.deepEqual(readPackageIdentity(moduleUrl), { name: 'mi-tool', version: '1.2.3' });
        });
        it('informa si falta el nombre o la versión', async function () {
            assert.throws(function () { readPackageIdentity(''); }, /./);
            const sinVersion = await fakePackage({ name: 'mi-tool' });
            assert.throws(function () { readPackageIdentity(sinVersion); }, /package\.json no tiene "version"$/);
            const sinNombre = await fakePackage({ version: '1.0.0' });
            assert.throws(function () { readPackageIdentity(sinNombre); }, /package\.json no tiene "name"$/);
        });
    });

    it('versionLine', function () {
        assert.equal(versionLine({ name: 'mi-tool', version: '1.2.3' }), 'mi-tool v1.2.3');
    });

    it('helpDescription agrega los códigos de salida', function () {
        assert.equal(helpDescription('Hace algo.', EXIT_CODES), 'Hace algo.\n\nCódigos de salida:\n  0  todo bien\n  3  error de configuración');
        assert.equal(helpDescription('Does something.', [{ code: 0, description: 'done' }], 'Exit codes:'), 'Does something.\n\nExit codes:\n  0  done');
    });

    describe('parseCommandLine', function () {
        it('interpreta con cleye y escribe la versión en la primera línea', async function () {
            const moduleUrl = await fakePackage({ name: 'mi-tool', version: '1.2.3' });
            const written: string[] = [];
            const commandLine = parseCommandLine({
                moduleUrl,
                description: 'Hace algo.',
                examples: ['mi-tool'],
                exitCodes: EXIT_CODES,
            }, function (base) {
                return cli({ ...base, parameters: ['[dir]'], flags: { json: { type: Boolean, description: 'Salida en JSON' } } }, undefined, ['carpeta', '--json']);
            }, { write: function (text) { written.push(text); } });
            // los tipos vienen de cleye: dir es string | undefined y json es boolean | undefined
            const dir: string | undefined = commandLine.parsed._.dir;
            const json: boolean | undefined = commandLine.parsed.flags.json;
            assert.equal(dir, 'carpeta');
            assert.equal(json, true);
            assert.deepEqual(commandLine.identity, { name: 'mi-tool', version: '1.2.3' });
            assert.deepEqual(written, ['mi-tool v1.2.3\n']);
        });
        it('acepta comandos de cleye', async function () {
            const moduleUrl = await fakePackage({ name: 'mi-tool', version: '1.2.3' });
            const written: string[] = [];
            const commandLine = parseCommandLine({
                moduleUrl,
                description: 'Hace algo.',
                examples: [],
                exitCodes: EXIT_CODES,
            }, function (base) {
                return cli({ ...base, commands: [command({ name: 'audit', parameters: ['[dir]'] })] }, undefined, ['audit', 'x']);
            }, { write: function (text) { written.push(text); } });
            assert.equal(commandLine.parsed.command, 'audit');
            assert.deepEqual(written, ['mi-tool v1.2.3\n']);
        });
        it('show permite omitir la línea con la versión', async function () {
            const moduleUrl = await fakePackage({ name: 'mi-tool', version: '1.2.3' });
            const written: string[] = [];
            parseCommandLine({
                moduleUrl,
                description: 'Hace algo.',
                examples: [],
                exitCodes: EXIT_CODES,
            }, function (base) {
                return cli({ ...base, flags: { json: { type: Boolean, description: 'Salida en JSON' } } }, undefined, ['--json']);
            }, {
                show: function (parsed) { return parsed.flags.json !== true; },
                write: function (text) { written.push(text); },
            });
            assert.deepEqual(written, []);
        });
    });
});
