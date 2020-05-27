import assert from "assert";
import { printComments } from "./comments";
// import { Lines, fromString, concat } from "./lines";
import { normalize as normalizeOptions } from "./options";
import { getReprinter } from "./patcher";
import * as types from "ast-types";
// const namedTypes = types.namedTypes;
const isString = types.builtInTypes.string;
const isObject = types.builtInTypes.object;
import FastPath from "./fast-path";
import * as util from "./util";

// @ts-ignore
import { __debug } from "prettier";

const {
  // parse,
  formatAST,
  // formatDoc,
  // printToDoc,
  // printDocToString,
} = __debug;


export interface PrintResultType {
    code: string;
    map?: any;
    toString(): string;
}

interface PrintResultConstructor {
    new(code: any, sourceMap?: any): PrintResultType;
}

const PrintResult = function PrintResult(this: PrintResultType, code: any, sourceMap?: any) {
    assert.ok(this instanceof PrintResult);

    isString.assert(code);
    this.code = code;

    if (sourceMap) {
        isObject.assert(sourceMap);
        this.map = sourceMap;
    }
} as any as PrintResultConstructor;

const PRp: PrintResultType = PrintResult.prototype;
let warnedAboutToString = false;

PRp.toString = function() {
    if (!warnedAboutToString) {
        console.warn(
            "Deprecation warning: recast.print now returns an object with " +
            "a .code property. You appear to be treating the object as a " +
            "string, which might still work but is strongly discouraged."
        );

        warnedAboutToString = true;
    }

    return this.code;
};

const emptyPrintResult = new PrintResult("");

interface PrinterType {
    print(ast: any): PrintResultType;
    printGenerically(ast: any): PrintResultType;
}

interface PrinterConstructor {
    new(config?: any): PrinterType;
}

const Printer = function Printer(this: PrinterType, config?: any) {
    assert.ok(this instanceof Printer);

    const explicitTabWidth = config && config.tabWidth;
    config = normalizeOptions(config);

    // It's common for client code to pass the same options into both
    // recast.parse and recast.print, but the Printer doesn't need (and
    // can be confused by) config.sourceFileName, so we null it out.
    config.sourceFileName = null;

    // Non-destructively modifies options with overrides, and returns a
    // new print function that uses the modified options.
    function makePrintFunctionWith(options: any, overrides: any) {
        options = Object.assign({}, options, overrides);
        return (path: any) => print(path, options);
    }

    function print(path: any, options: any) {
        assert.ok(path instanceof FastPath);
        options = options || {};

        if (options.includeComments) {
            return printComments(path, makePrintFunctionWith(options, {
                includeComments: false
            }));
        }

        const oldTabWidth = config.tabWidth;

        if (! explicitTabWidth) {
            const loc = path.getNode().loc;
            if (loc && loc.lines && loc.lines.guessTabWidth) {
                config.tabWidth = loc.lines.guessTabWidth();
            }
        }

        const reprinter = getReprinter(path);
        const lines = reprinter
            // Since the print function that we pass to the reprinter will
            // be used to print "new" nodes, it's tempting to think we
            // should pass printRootGenerically instead of print, to avoid
            // calling maybeReprint again, but that would be a mistake
            // because the new nodes might not be entirely new, but merely
            // moved from elsewhere in the AST. The print function is the
            // right choice because it gives us the opportunity to reprint
            // such nodes using their original source.
            ? reprinter(print)
            : genericPrint(
                path,
                {...config,
                ...options},
                makePrintFunctionWith(options, {
                    includeComments: true,
                    avoidRootParens: false
                })
            );

        config.tabWidth = oldTabWidth;

        return lines;
    }

    this.print = function(ast) {
        if (!ast) {
            return emptyPrintResult;
        }

        const lines = print(FastPath.from(ast), {
            includeComments: true,
            avoidRootParens: false
        });

        return new PrintResult(
            lines.toString(config),
            util.composeSourceMaps(
                config.inputSourceMap,
                lines.getSourceMap(
                    config.sourceMapName,
                    config.sourceRoot
                )
            )
        );
    };

    this.printGenerically = function(ast) {
        if (!ast) {
            return emptyPrintResult;
        }

        // Print the entire AST generically.
        function printGenerically(path: any) {
            return printComments(path, (path: any) => genericPrint(path, {...config, 
                includeComments: true,
                avoidRootParens: false
            }, printGenerically));
        }

        const path = FastPath.from(ast);
        const oldReuseWhitespace = config.reuseWhitespace;

        // Do not reuse whitespace (or anything else, for that matter)
        // when printing generically.
        config.reuseWhitespace = false;

        // TODO Allow printing of comments?
        const pr = new PrintResult(printGenerically(path).toString(config));
        config.reuseWhitespace = oldReuseWhitespace;
        return pr;
    };
} as any as PrinterConstructor;

export { Printer };

function genericPrint(path: any, /*config: any,*/ options: any, printx: any) {
    console.log("genericPrint", path, options, printx);
    const result = formatAST(path.getValue(), {
        parser: "typescript",
        originalText: new Printer(options).print(path).code
    });
    console.log("genericPrint", result);
    return result.formatted;
}
