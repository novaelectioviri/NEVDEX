import { CompilerConfig } from '@ton/blueprint';

export const compile: CompilerConfig = {
    lang: 'tact',
    target: 'contracts/governance_nft_collection.tact',
    options: {
        debug: true,
    },
};
