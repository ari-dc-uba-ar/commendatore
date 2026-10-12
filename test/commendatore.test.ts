import { strict as assert } from 'node:assert';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';
import {
    cli, command, CommandLineError, createConfirmer, detectLanguage, helpDescription, parseCommandLine, readLangFlag, readPackageIdentity,
    translator, versionLine,
} from '../src/commendatore.js';
import type { ExitCode, I18n } from '../src/commendatore.js';

const EXIT_CODES: ExitCode[] = [
    { code: 0, description: 'all ok' },
    { code: 3, description: 'configuration error' },
];

/** Simulates a terminal: each answer is written to the input only when a question appears in the output. */
function fakeTerminal(answers: string[], isTTY: boolean = true) {
    const input = Object.assign(new PassThrough(), { isTTY });
    const output = new PassThrough();
    const questions: string[] = [];
    output.on('data', function (chunk: Buffer) {
        questions.push(chunk.toString());
        const answer = answers.shift();
        if (answer !== undefined) input.write(answer + '\n');
    });
    return { input, output, questions };
}

/** Creates a test package with a module in bin/ and returns the URL of that module. */
async function fakePackage(packageJson: unknown): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'commendatore-'));
    await mkdir(join(dir, 'bin'));
    await writeFile(join(dir, 'package.json'), JSON.stringify(packageJson));
    return pathToFileURL(join(dir, 'bin', 'my-tool-cli.js')).href;
}

describe('commendatore', function () {
    describe('detectLanguage', function () {
        it('prefers the explicit language', function () {
            assert.equal(detectLanguage('es', { LANG: 'fr_FR.UTF-8' }, 'de-DE'), 'es');
        });
        it('then the environment, in gettext order, taking only the language part', function () {
            assert.equal(detectLanguage(undefined, { LANGUAGE: 'pt_BR:en', LC_ALL: 'fr_FR.UTF-8' }, 'de-DE'), 'pt');
            assert.equal(detectLanguage(undefined, { LC_ALL: 'fr_FR.UTF-8', LANG: 'es_AR.UTF-8' }, 'de-DE'), 'fr');
            assert.equal(detectLanguage(undefined, { LC_MESSAGES: 'it_IT', LANG: 'es_AR.UTF-8' }, 'de-DE'), 'it');
            assert.equal(detectLanguage(undefined, { LANG: 'es_AR.UTF-8' }, 'de-DE'), 'es');
        });
        it('ignores C and POSIX and then uses the system locale', function () {
            assert.equal(detectLanguage(undefined, { LC_ALL: 'C', LANG: 'POSIX' }, 'de-DE'), 'de');
            assert.equal(detectLanguage(undefined, { LANG: 'C.UTF-8' }, 'es-AR'), 'es');
        });
        it('falls back to English', function () {
            assert.equal(detectLanguage(undefined, {}, ''), 'en');
        });
        it('detects from the real environment by default', function () {
            assert.match(detectLanguage(), /^[a-z]{2,3}$/);
        });
    });

    describe('translator', function () {
        const messages = { hello: 'hello', deleteFile1In2: 'delete $1 in $2?' };
        const i18nOfTest: I18n<typeof messages> = { messages: { en: messages, es: { deleteFile1In2: '¿borrar $1 en $2?' } } };
        it('uses the language and replaces the parameters', function () {
            assert.equal(translator(i18nOfTest, 'es')('deleteFile1In2', 'a.txt', 'docs'), '¿borrar a.txt en docs?');
            assert.equal(translator(i18nOfTest, 'en')('deleteFile1In2', 'a.txt', 3), 'delete a.txt in 3?');
        });
        it('shows in English a missing message or a missing language', function () {
            assert.equal(translator(i18nOfTest, 'es')('hello'), 'hello');
            assert.equal(translator(i18nOfTest, 'fr')('hello'), 'hello');
        });
        it('throws when a parameter is missing', function () {
            assert.throws(function () { translator(i18nOfTest, 'en')('deleteFile1In2', 'a.txt'); }, /missing parameter \$2 of the message "deleteFile1In2"/);
        });
    });

    describe('readLangFlag', function () {
        it('reads --lang=xx and --lang xx', function () {
            assert.equal(readLangFlag(['audit', '--lang=es', 'dir']), 'es');
            assert.equal(readLangFlag(['--lang', 'en', 'audit']), 'en');
            assert.equal(readLangFlag(['audit']), undefined);
        });
        it('ignores what comes after --', function () {
            assert.equal(readLangFlag(['run', '--', '--lang=es']), undefined);
        });
        it('requires a value, with the message in the current language', function () {
            assert.throws(function () { readLangFlag(['--lang'], 'en'); }, function (err: unknown) {
                return err instanceof CommandLineError && /^--lang needs a language/.test(err.message);
            });
            assert.throws(function () { readLangFlag(['--lang', '--json'], 'es'); }, /--lang necesita un idioma/);
            assert.throws(function () { readLangFlag(['--lang='], 'en'); }, /--lang needs a language/);
        });
    });

    describe('createConfirmer', function () {
        it('with the decision true confirms everything without asking', async function () {
            const terminal = fakeTerminal([]);
            const confirm = createConfirmer({ decision: true, question: 'delete', input: terminal.input, output: terminal.output });
            assert.deepEqual(await confirm('a.txt'), { confirmed: true });
            assert.deepEqual(await confirm('b.txt'), { confirmed: true });
            assert.deepEqual(terminal.questions, []);
        });
        it('with the decision false confirms nothing and does not ask', async function () {
            const terminal = fakeTerminal([]);
            const confirm = createConfirmer({ decision: false, question: 'delete', input: terminal.input, output: terminal.output });
            assert.deepEqual(await confirm('a.txt'), { confirmed: false, reason: 'disabled' });
            assert.deepEqual(terminal.questions, []);
        });
        it('without a terminal does not confirm because there is nobody to ask', async function () {
            const terminal = fakeTerminal(['y'], false);
            const confirm = createConfirmer({ decision: undefined, question: 'delete', input: terminal.input, output: terminal.output });
            assert.deepEqual(await confirm('a.txt'), { confirmed: false, reason: 'needs-tty' });
            assert.deepEqual(terminal.questions, []);
        });
        it('asks for each item: y or s confirm, anything else does not', async function () {
            const terminal = fakeTerminal(['y', 'S', '', 'n', 'x']);
            const confirm = createConfirmer({ decision: undefined, question: 'delete', input: terminal.input, output: terminal.output });
            assert.deepEqual(await confirm('a.txt'), { confirmed: true });
            assert.deepEqual(await confirm('b.txt'), { confirmed: true });
            assert.deepEqual(await confirm('c.txt'), { confirmed: false, reason: 'declined' });
            assert.deepEqual(await confirm('d.txt'), { confirmed: false, reason: 'declined' });
            assert.deepEqual(await confirm('e.txt'), { confirmed: false, reason: 'declined' });
            assert.deepEqual(terminal.questions[0], 'delete a.txt [y/N] ');
        });
        it('with allowAll, the answer a confirms this one and all the following without asking again', async function () {
            const terminal = fakeTerminal(['n', 'a']);
            const confirm = createConfirmer({ decision: undefined, question: 'renormalize', allowAll: true, input: terminal.input, output: terminal.output });
            assert.deepEqual(await confirm('a.txt'), { confirmed: false, reason: 'declined' });
            assert.deepEqual(await confirm('b.txt'), { confirmed: true });
            assert.deepEqual(await confirm('c.txt'), { confirmed: true });
            assert.deepEqual(terminal.questions, ['renormalize a.txt [y/N/a] ', 'renormalize b.txt [y/N/a] ']);
        });
        it('without allowAll, the answer a does not confirm', async function () {
            const terminal = fakeTerminal(['a']);
            const confirm = createConfirmer({ decision: undefined, question: 'delete', input: terminal.input, output: terminal.output });
            assert.deepEqual(await confirm('a.txt'), { confirmed: false, reason: 'declined' });
        });
    });

    describe('readPackageIdentity', function () {
        it('reads name and version of package.json going up from the folder of the module', async function () {
            const moduleUrl = await fakePackage({ name: 'my-tool', version: '1.2.3' });
            assert.deepEqual(readPackageIdentity(moduleUrl), { name: 'my-tool', version: '1.2.3' });
        });
        it('reports a missing name or version, in the given language', async function () {
            assert.throws(function () { readPackageIdentity(''); }, /./);
            const withoutVersion = await fakePackage({ name: 'my-tool' });
            assert.throws(function () { readPackageIdentity(withoutVersion, 'en'); }, /package\.json has no "version"$/);
            assert.throws(function () { readPackageIdentity(withoutVersion, 'es'); }, /package\.json no tiene "version"$/);
            const withoutName = await fakePackage({ version: '1.0.0' });
            assert.throws(function () { readPackageIdentity(withoutName, 'en'); }, /package\.json has no "name"$/);
            const notAnObject = await fakePackage([]);
            assert.throws(function () { readPackageIdentity(notAnObject, 'en'); }, /package\.json does not contain an object$/);
        });
    });

    it('versionLine', function () {
        assert.equal(versionLine({ name: 'my-tool', version: '1.2.3' }), 'my-tool v1.2.3');
    });

    it('helpDescription adds the exit codes, in the given language', function () {
        assert.equal(helpDescription('Does something.', EXIT_CODES, 'en'), 'Does something.\n\nExit codes:\n  0  all ok\n  3  configuration error');
        assert.equal(helpDescription('Hace algo.', [{ code: 0, description: 'listo' }], 'es'), 'Hace algo.\n\nCódigos de salida:\n  0  listo');
    });

    describe('parseCommandLine', function () {
        it('parses with cleye and writes the version on the first line', async function () {
            const moduleUrl = await fakePackage({ name: 'my-tool', version: '1.2.3' });
            const written: string[] = [];
            const commandLine = parseCommandLine({
                moduleUrl,
                description: 'Does something.',
                examples: ['my-tool'],
                exitCodes: EXIT_CODES,
                argv: ['folder', '--json', '--lang=es'],
            }, function (base, argv) {
                return cli({ ...base, parameters: ['[dir]'], flags: { ...base.flags, json: { type: Boolean, description: 'JSON output' } } }, undefined, argv);
            }, { write: function (text) { written.push(text); } });
            const dir: string | undefined = commandLine.parsed._.dir;
            const json: boolean | undefined = commandLine.parsed.flags.json;
            const lang: string | undefined = commandLine.parsed.flags.lang;
            assert.equal(dir, 'folder');
            assert.equal(json, true);
            assert.equal(lang, 'es');
            assert.equal(commandLine.lang, 'es');
            assert.deepEqual(commandLine.identity, { name: 'my-tool', version: '1.2.3' });
            assert.deepEqual(written, ['my-tool v1.2.3\n']);
        });
        it('accepts cleye commands', async function () {
            const moduleUrl = await fakePackage({ name: 'my-tool', version: '1.2.3' });
            const written: string[] = [];
            const commandLine = parseCommandLine({
                moduleUrl,
                description: 'Does something.',
                examples: [],
                exitCodes: EXIT_CODES,
                argv: ['audit', 'x', '--lang', 'es'],
            }, function (base, argv) {
                return cli({ ...base, commands: [command({ name: 'audit', parameters: ['[dir]'], flags: { ...base.flags } })] }, undefined, argv);
            }, { write: function (text) { written.push(text); } });
            assert.equal(commandLine.parsed.command, 'audit');
            assert.equal(commandLine.parsed.flags.lang, 'es');
            assert.equal(commandLine.lang, 'es');
            assert.deepEqual(written, ['my-tool v1.2.3\n']);
        });
        it('show allows omitting the version line', async function () {
            const moduleUrl = await fakePackage({ name: 'my-tool', version: '1.2.3' });
            const written: string[] = [];
            parseCommandLine({
                moduleUrl,
                description: 'Does something.',
                examples: [],
                exitCodes: EXIT_CODES,
                argv: ['--json'],
            }, function (base, argv) {
                return cli({ ...base, flags: { json: { type: Boolean, description: 'JSON output' } } }, undefined, argv);
            }, {
                show: function (parsed) { return parsed.flags.json !== true; },
                write: function (text) { written.push(text); },
            });
            assert.deepEqual(written, []);
        });
    });
});
