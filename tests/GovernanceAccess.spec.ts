import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { beginCell, Cell, toNano } from '@ton/core';
import {
    GovernanceNftCollection,
} from '../wrappers/GovernanceNftCollection';
import {
    GovernanceJettonMinter,
} from '../wrappers/GovernanceJettonMinter';
import { GovernanceNftItem } from '../build/GovernanceNftCollection/tact_GovernanceNftItem';
import { GovernanceJettonWallet } from '../build/GovernanceJettonMinter/tact_GovernanceJettonWallet';
import '@ton/test-utils';

describe('Governance access contracts', () => {
    let blockchain: Blockchain;
    let admin: SandboxContract<TreasuryContract>;
    let memberA: SandboxContract<TreasuryContract>;
    let memberB: SandboxContract<TreasuryContract>;
    let nftCollection: SandboxContract<GovernanceNftCollection>;
    let jettonMinter: SandboxContract<GovernanceJettonMinter>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        admin = await blockchain.treasury('admin');
        memberA = await blockchain.treasury('memberA');
        memberB = await blockchain.treasury('memberB');

        const collectionContent = beginCell()
            .storeUint(0x01, 8)
            .storeStringTail('https://example.com/governance/nft-collection.json')
            .endCell();
        nftCollection = blockchain.openContract(
            await GovernanceNftCollection.fromInit(admin.address, collectionContent),
        );

        const jettonContent = beginCell()
            .storeUint(0x01, 8)
            .storeStringTail('https://example.com/governance/jetton.json')
            .endCell();
        jettonMinter = blockchain.openContract(
            await GovernanceJettonMinter.fromInit(admin.address, jettonContent),
        );

        const deployCollection = await nftCollection.send(
            admin.getSender(),
            { value: toNano('0.25') },
            { $$type: 'Deploy', queryId: 1n },
        );
        expect(deployCollection.transactions).toHaveTransaction({
            from: admin.address,
            to: nftCollection.address,
            deploy: true,
            success: true,
        });

        const deployMinter = await jettonMinter.send(
            admin.getSender(),
            { value: toNano('0.25') },
            { $$type: 'Deploy', queryId: 2n },
        );
        expect(deployMinter.transactions).toHaveTransaction({
            from: admin.address,
            to: jettonMinter.address,
            deploy: true,
            success: true,
        });
    });

    it('mints governance NFT membership to recipient', async () => {
        const mint = await nftCollection.send(
            admin.getSender(),
            { value: toNano('0.15') },
            {
                $$type: 'MintGovernanceNft',
                queryId: 10n,
                recipient: memberA.address,
                metadataUri: 'https://example.com/governance/member-a.json',
            },
        );

        const itemAddress = await nftCollection.getGetNftAddressByIndex(0n);
        expect(mint.transactions).toHaveTransaction({
            from: nftCollection.address,
            to: itemAddress,
            success: true,
            deploy: true,
        });
        expect(await nftCollection.getGetCollectionNextItemIndex()).toBe(1n);

        const nftItem = blockchain.openContract(
            GovernanceNftItem.fromAddress(itemAddress),
        );
        expect(await nftItem.getOwner()).toEqualAddress(memberA.address);
    });

    it('transfers governance NFT membership between users', async () => {
        await nftCollection.send(
            admin.getSender(),
            { value: toNano('0.15') },
            {
                $$type: 'MintGovernanceNft',
                queryId: 20n,
                recipient: memberA.address,
                metadataUri: 'https://example.com/governance/member-a.json',
            },
        );

        const itemAddress = await nftCollection.getGetNftAddressByIndex(0n);
        const nftItem = blockchain.openContract(
            GovernanceNftItem.fromAddress(itemAddress),
        );
        const transfer = await nftItem.send(
            memberA.getSender(),
            { value: toNano('0.1') },
            {
                $$type: 'NftTransfer',
                queryId: 21n,
                newOwner: memberB.address,
                responseDestination: memberA.address,
                customPayload: null,
                forwardAmount: toNano('0.01'),
                forwardPayload: beginCell().storeUint(0x7777, 16).endCell().beginParse(),
            },
        );

        expect(transfer.transactions).toHaveTransaction({
            from: nftItem.address,
            to: memberB.address,
            success: true,
        });
        expect(await nftItem.getOwner()).toEqualAddress(memberB.address);
    });

    it('mints governance jettons and transfers balances', async () => {
        const mint = await jettonMinter.send(
            admin.getSender(),
            { value: toNano('0.2') },
            {
                $$type: 'MintGovernanceJettons',
                queryId: 30n,
                recipient: memberA.address,
                amount: toNano('150'),
            },
        );

        const memberAWalletAddress = await jettonMinter.getGetWalletAddress(memberA.address);
        expect(memberAWalletAddress).not.toBeNull();
        expect(mint.transactions).toHaveTransaction({
            from: jettonMinter.address,
            to: memberAWalletAddress!,
            success: true,
            deploy: true,
        });

        const memberAWallet = blockchain.openContract(
            GovernanceJettonWallet.fromAddress(memberAWalletAddress!),
        );
        expect(await memberAWallet.getBalance()).toBe(toNano('150'));
        expect(await jettonMinter.getTotalSupply()).toBe(toNano('150'));

        const transfer = await memberAWallet.send(
            memberA.getSender(),
            { value: toNano('0.2') },
            {
                $$type: 'JettonTransfer',
                queryId: 31n,
                amount: toNano('40'),
                destination: memberB.address,
                responseDestination: memberA.address,
                customPayload: null,
                forwardTonAmount: toNano('0.02'),
                forwardPayload: beginCell().storeUint(0x4242, 16).endCell().beginParse(),
            },
        );
        const resolvedMemberBWallet = await GovernanceJettonWallet.fromInit(
            memberB.address,
            jettonMinter.address,
        ).then((wallet) => wallet.address);
        expect(transfer.transactions).toHaveTransaction({
            from: memberAWallet.address,
            to: resolvedMemberBWallet,
            success: true,
            deploy: true,
        });

        const memberBWallet = blockchain.openContract(
            GovernanceJettonWallet.fromAddress(resolvedMemberBWallet),
        );
        expect(await memberAWallet.getBalance()).toBe(toNano('110'));
        expect(await memberBWallet.getBalance()).toBe(toNano('40'));

        expect(transfer.transactions).toHaveTransaction({
            from: resolvedMemberBWallet,
            to: memberB.address,
            success: true,
            body: (body) => {
                if (!(body instanceof Cell)) {
                    return false;
                }
                const slice = body.beginParse();
                const op = slice.loadUint(32);
                const queryId = slice.loadUintBig(64);
                const amount = slice.loadCoins();
                const sender = slice.loadAddress();
                return (
                    op === 0x7362d09c &&
                    queryId === 31n &&
                    amount === toNano('40') &&
                    sender.equals(memberA.address)
                );
            },
        });
    });

    it('rejects non-owner mint attempts for both access contracts', async () => {
        const nftMintByAttacker = await nftCollection.send(
            memberA.getSender(),
            { value: toNano('0.15') },
            {
                $$type: 'MintGovernanceNft',
                queryId: 40n,
                recipient: memberA.address,
                metadataUri: 'https://example.com/governance/member-a.json',
            },
        );
        expect(nftMintByAttacker.transactions).toHaveTransaction({
            from: memberA.address,
            to: nftCollection.address,
            success: false,
        });

        const jettonMintByAttacker = await jettonMinter.send(
            memberA.getSender(),
            { value: toNano('0.15') },
            {
                $$type: 'MintGovernanceJettons',
                queryId: 41n,
                recipient: memberA.address,
                amount: toNano('1'),
            },
        );
        expect(jettonMintByAttacker.transactions).toHaveTransaction({
            from: memberA.address,
            to: jettonMinter.address,
            success: false,
        });
    });

    it('rejects non-owner transfer attempts for governance NFT and jettons', async () => {
        await nftCollection.send(
            admin.getSender(),
            { value: toNano('0.15') },
            {
                $$type: 'MintGovernanceNft',
                queryId: 50n,
                recipient: memberA.address,
                metadataUri: 'https://example.com/governance/member-a.json',
            },
        );

        await jettonMinter.send(
            admin.getSender(),
            { value: toNano('0.2') },
            {
                $$type: 'MintGovernanceJettons',
                queryId: 51n,
                recipient: memberA.address,
                amount: toNano('10'),
            },
        );

        const itemAddress = await nftCollection.getGetNftAddressByIndex(0n);
        const nftItem = blockchain.openContract(
            GovernanceNftItem.fromAddress(itemAddress),
        );
        const nftHijack = await nftItem.send(
            memberB.getSender(),
            { value: toNano('0.1') },
            {
                $$type: 'NftTransfer',
                queryId: 52n,
                newOwner: memberB.address,
                responseDestination: memberB.address,
                customPayload: null,
                forwardAmount: 0n,
                forwardPayload: beginCell().endCell().beginParse(),
            },
        );
        expect(nftHijack.transactions).toHaveTransaction({
            from: memberB.address,
            to: nftItem.address,
            success: false,
        });

        const memberAWalletAddress = await jettonMinter.getGetWalletAddress(memberA.address);
        expect(memberAWalletAddress).not.toBeNull();
        const memberAWallet = blockchain.openContract(
            GovernanceJettonWallet.fromAddress(memberAWalletAddress!),
        );
        const jettonHijack = await memberAWallet.send(
            memberB.getSender(),
            { value: toNano('0.2') },
            {
                $$type: 'JettonTransfer',
                queryId: 53n,
                amount: toNano('1'),
                destination: memberB.address,
                responseDestination: memberB.address,
                customPayload: null,
                forwardTonAmount: 0n,
                forwardPayload: beginCell().endCell().beginParse(),
            },
        );
        expect(jettonHijack.transactions).toHaveTransaction({
            from: memberB.address,
            to: memberAWallet.address,
            success: false,
        });
    });
});
