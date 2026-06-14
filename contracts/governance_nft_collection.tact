import "@stdlib/deploy";
import "./governance_nft_messages.tact";
import "./governance_nft_item.tact";

const NFT_ITEM_DEPLOY_FORWARD: Int = ton("0.06");

contract GovernanceNftCollection with Deployable {
    owner: Address;
    nextItemIndex: Int as uint64;
    collectionContent: Cell;
    itemAddressByIndex: map<Int, Address>;

    init(owner: Address, collectionContent: Cell) {
        self.owner = owner;
        self.nextItemIndex = 0;
        self.collectionContent = collectionContent;
    }

    receive(msg: MintGovernanceNft) {
        require(sender() == self.owner, "NFT_COLLECTION_NOT_OWNER");
        let itemIndex = self.nextItemIndex;
        let itemContent = beginCell()
            .storeUint(0x01, 8)
            .storeSlice(beginString().concat(msg.metadataUri).toSlice())
            .endCell();
        let itemState = initOf GovernanceNftItem(msg.recipient, myAddress(), itemIndex, itemContent);
        let itemAddress = contractAddress(itemState);

        send(SendParameters{
            to: itemAddress,
            value: NFT_ITEM_DEPLOY_FORWARD,
            mode: SendPayGasSeparately,
            bounce: false,
            body: null,
            code: itemState.code,
            data: itemState.data,
        });

        self.itemAddressByIndex.set(itemIndex, itemAddress);
        self.nextItemIndex = itemIndex + 1;
    }

    receive(msg: UpdateCollectionContent) {
        require(sender() == self.owner, "NFT_COLLECTION_NOT_OWNER");
        self.collectionContent = msg.content;
    }

    receive() {}

    get fun collectionOwner(): Address {
        return self.owner;
    }

    get fun nextItemIndex(): Int {
        return self.nextItemIndex;
    }

    get fun getCollectionNextItemIndex(): Int {
        return self.nextItemIndex;
    }

    get fun getCollectionContent(): Cell {
        return self.collectionContent;
    }

    get fun getCollectionOwnerAddress(): Address {
        return self.owner;
    }

    get fun getNftAddressByIndex(index: Int): Address {
        require(self.itemAddressByIndex.exists(index), "NFT_ITEM_NOT_MINTED");
        return self.itemAddressByIndex.get(index)!!;
    }

    get fun getNftContent(index: Int, individualContent: Cell): Cell {
        require(self.itemAddressByIndex.exists(index), "NFT_ITEM_NOT_MINTED");
        return individualContent;
    }
}
