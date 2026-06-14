import { CompilerConfig } from '@ton/blueprint';

export const compile: CompilerConfig = {
    lang: 'tact',
    target: 'contracts/governance_jetton_minter.tact',
    options: {
        debug: true,
    },
};
