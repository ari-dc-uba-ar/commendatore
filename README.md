# commendatore

Forma común de armar la línea de comandos de las herramientas (los módulos `*-cli`), sobre [cleye](https://www.npmjs.com/package/cleye):

* el nombre y la versión salen del `package.json` del paquete;
* la primera línea de la salida es `nombre vX.Y.Z` (se puede omitir, por ejemplo cuando la salida es JSON);
* la ayuda lista los códigos de salida;
* los flags desconocidos son un error (`strictFlags`).

Los parámetros, flags y comandos se definen con cleye, que infiere sus tipos. `cli` y `command` se importan de commendatore, para que las herramientas no dependan de cleye directamente.

## Uso

```js
import { cli, parseCommandLine, runMain } from 'commendatore';

export async function main(argv) {
    const { parsed } = parseCommandLine({
        moduleUrl: import.meta.url,
        description: 'Hace algo con la carpeta indicada.',
        examples: ['mi-tool', 'mi-tool ../otra-carpeta'],
        exitCodes: [
            { code: 0, description: 'terminó bien' },
            { code: 1, description: 'error de configuración' },
        ],
    }, function (base) {
        return cli({ ...base, parameters: ['[dir]'], flags: { json: { type: Boolean, description: 'Salida en JSON' } } }, undefined, argv);
    }, {
        show: function (parsed) { return parsed.flags.json !== true; },
    });
    // parsed._.dir es string | undefined; parsed.flags.json es boolean | undefined
    return 0;
}

if (import.meta.main) {
    runMain(function () { return main(process.argv.slice(2)); }, 1);
}
```

## License

[MIT](LICENSE)
