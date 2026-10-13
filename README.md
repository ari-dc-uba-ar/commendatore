# commendatore

Common way to build the command line of the tools: version on the first line, exit codes in the help, strict flags, --lang with i18n of the messages and confirmation of actions, on top of cleye


[![npm-version](https://img.shields.io/npm/v/commendatore.svg)](https://npmjs.org/package/commendatore)
[![downloads](https://img.shields.io/npm/dm/commendatore.svg)](https://npmjs.org/package/commendatore)
[![build](https://github.com/ari-dc-uba-ar/commendatore/actions/workflows/build-and-test.yml/badge.svg)](https://github.com/ari-dc-uba-ar/commendatore/actions/workflows/build-and-test.yml)
[![qa-control](https://github.com/ari-dc-uba-ar/commendatore/actions/workflows/qa-control.yml/badge.svg)](https://github.com/ari-dc-uba-ar/commendatore/actions/workflows/qa-control.yml)


language: ![English](https://raw.githubusercontent.com/codenautas/multilang/master/img/lang-en.png)
also available in:
[![Spanish](https://raw.githubusercontent.com/codenautas/multilang/master/img/lang-es.png)](LEEME.md) -
[![Italian](https://raw.githubusercontent.com/codenautas/multilang/master/img/lang-it.png)](LEGGIMI.md)


Common way to build the command line of the tools (the `*-cli` modules), on top of
[cleye](https://www.npmjs.com/package/cleye):

* the name and the version come from the package's `package.json`;
* the first output line is `name vX.Y.Z` (it can be omitted, i.e. when the output is JSON);
* the help lists the exit codes;
* unknown flags are an error (`strictFlags`);
* every command accepts `--lang` and the messages are shown in that language.


The parameters, flags and commands are defined with cleye, which infers their types. `cli` and
`command` are imported from commendatore, so the tools do not depend on cleye directly.


## Usage


```js
import { cli, parseCommandLine, runMain } from 'commendatore';

export async function main(argv) {
    const { parsed, lang } = parseCommandLine({
        moduleUrl: import.meta.url,
        description: 'Does something with the given folder.',
        examples: ['my-tool', 'my-tool ../other-folder'],
        exitCodes: [
            { code: 0, description: 'done' },
            { code: 1, description: 'configuration error' },
        ],
        argv,
    }, function (base, argv) {
        return cli({ ...base, parameters: ['[dir]'], flags: { ...base.flags, json: { type: Boolean, description: 'JSON output' } } }, undefined, argv);
    }, {
        show: function (parsed) { return parsed.flags.json !== true; },
    });
    // parsed._.dir is string | undefined; parsed.flags.json is boolean | undefined; lang is i.e. "es"
    return 0;
}

if (import.meta.main) {
    runMain(function () { return main(process.argv.slice(2)); }, 1);
}
```


`base.flags` brings `--lang`: if the tool declares its own flags, or commands, it must include it
in each one (`flags: { ...base.flags, ... }`). If it is forgotten, `--lang` in that command is an
unknown flag and cleye reports it as an error.

For the help to be in the language of the messages too, `description`, `examples` and
`exitCodes` can be functions of the language (`function (lang) { ... }`), and `parse` receives
the language as its third parameter for the descriptions of its commands and flags.


## Language of the messages


The language is the one of `--lang`; if absent, the one of the environment (`LANGUAGE`, `LC_ALL`,
`LC_MESSAGES`, `LANG`); if not, the one the operating system reports to Node; and if not, English
(`detectLanguage`).

Each module declares its messages with English as the base (which defines the keys) and the
other languages partial: what is missing is shown in English. The keys are _camelCase_ and the
numbers denote parameters (`$1`, `$2`...):


```ts
import { translator } from 'commendatore';
import type { I18n } from 'commendatore';

export const messages = {
    deleteFile1In2: 'delete $1 in $2?',
};

export const i18n: I18n<typeof messages> = {
    messages: {
        en: messages,
        es: { deleteFile1In2: '¿borrar $1 en $2?' },
    },
};

const message = translator(i18n, lang);
message('deleteFile1In2', 'a.txt', 'docs'); // "¿borrar a.txt en docs?" with lang = "es"
```


## Confirming actions


When a tool is about to do something the user has to approve (delete a file, touch the git index),
the command line has a boolean flag: present is yes to all, `=false` is no to all, and if absent
it asks item by item. `createConfirmer` receives that decision and returns the function that
confirms each item:


```js
import { createConfirmer } from 'commendatore';

const confirm = createConfirmer({ decision: parsed.flags.delete, question: 'delete', allowAll: true });
for (const file of files) {
    const { confirmed, reason } = await confirm(file); // asks "delete file.txt [y/N/a] "
    if (confirmed) {
        // ...
    } else {
        console.log('NOT DELETED:', file, reason); // 'declined' | 'disabled' | 'needs-tty'
    }
}
```


Answers: `y` or `s` = yes; `a` (with `allowAll`) = yes to that one and all the following; anything
else = no. Without a terminal (i.e. in CI) there is nobody to answer and it is not confirmed
(`needs-tty`). The function only writes the question: reporting what was not done is up to each
tool.


## License


[MIT](LICENSE)
