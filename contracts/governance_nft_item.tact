import "./governance_nft_messages.tact";

contract GovernanceNftItem {
    owner: Address;
    collection: Address;
    index: Int as uint64;
    content: Cell;

    init(owner: Address, collection: Address, index: Int, content: Cell) {
        self.owner = owner;
        self.collection = collection;
        self.index = index;
        self.content = content;
    }

    receive(msg: NftTransfer) {
        require(sender() == self.owner, "NFT_NOT_OWNER");
        let prevOwner = self.owner;
        self.owner = msg.newOwner;

        if (msg.forwardAmount > 0) {
            send(SendParameters{
                to: msg.newOwner,
                value: msg.forwardAmount,
                mode: SendPayGasSeparately,
                bounce: false,
                body: NftOwnershipAssigned{
                    queryId: msg.queryId,
                    prevOwner: prevOwner,
                    forwardPayload: msg.forwardPayload,
                }.toCell(),
            });
        }
    }

    receive() {}

    get fun owner(): Address {
        return self.owner;
    }

    get fun collection(): Address {
        return self.collection;
    }

    get fun index(): Int {
        return self.index;
    }

    get fun content(): Cell {
        return self.content;
    }
}
