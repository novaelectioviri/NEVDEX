message MintGovernanceNft {
    queryId: Int as uint64;
    recipient: Address;
    metadataUri: String;
}

message UpdateCollectionContent {
    queryId: Int as uint64;
    content: Cell;
}

message(0x5fcc3d14) NftTransfer {
    queryId: Int as uint64;
    newOwner: Address;
    responseDestination: Address;
    customPayload: Cell?;
    forwardAmount: Int as coins;
    forwardPayload: Slice as remaining;
}

message(0x05138d91) NftOwnershipAssigned {
    queryId: Int as uint64;
    prevOwner: Address;
    forwardPayload: Slice as remaining;
}
