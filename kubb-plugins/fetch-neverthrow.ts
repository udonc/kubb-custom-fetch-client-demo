import type { Output, PluginFactoryOptions } from "kubb/kit";
import { ast, defineGenerator, definePlugin } from "kubb/kit";

type Options = {
  output?: Output;
};

type ResolvedOptions = {
  output: Output;
};

type PluginHello = PluginFactoryOptions<
  "plugin-hello",
  Options,
  ResolvedOptions
>;

const helloGenerator = defineGenerator<PluginHello>({
  name: "hello-generator",
  operation: (node, ctx) => {
    const file = ctx.resolver.file({
      name: node.operationId,
      extname: ".ts",
      root: ctx.root,
      output: ctx.options.output,
    });
    return [
      ast.factory.createFile({
        baseName: file.baseName,
        path: file.path,
        sources: [
          ast.factory.createSource({
            name: node.operationId,
            isExportable: true,
            isIndexable: true,
            nodes: [
              ast.factory.createText(
                `export const ${node.operationId} = "${node.method} ${node.path}";\n`,
              ),
            ],
          }),
        ],
      }),
    ];
  },
});

export const pluginHello = definePlugin<PluginHello>((options) => {
  const { output = { path: "hello", barrel: { type: "named" } } } = options;
  return {
    name: "plugin-hello",
    options,
    hooks: {
      "kubb:plugin:setup"(ctx) {
        ctx.setOptions({ output });
        ctx.addGenerator(helloGenerator);
      },
    },
  };
});
