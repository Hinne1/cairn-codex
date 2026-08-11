using System.Text.Json;
using CairnCodex.GrimDawn;

const int ProtocolVersion = 1;
using var liveGame = new LiveGameAdapter();
var jsonOptions = new JsonSerializerOptions
{
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase
};

string? line;
while ((line = Console.ReadLine()) is not null)
{
    HelperRequest? request = null;
    HelperResponse response;

    try
    {
        request = JsonSerializer.Deserialize<HelperRequest>(line, jsonOptions)
            ?? throw new JsonException("Request body is empty.");

        response = request.Method switch
        {
            "health" => HelperResponse.Success(request.Id, new
            {
                service = "CairnCodex.GrimDawn",
                protocolVersion = ProtocolVersion,
                mode = "read-only"
            }),
            "discover-grim-dawn" => HelperResponse.Success(request.Id, GrimDawnDiscovery.Discover()),
            "build-item-catalog" => BuildItemCatalog(request),
            "inspect-game-record" => InspectGameRecord(request),
            "extract-item-icons" => ExtractItemIcons(request),
            "scan-collection" => HelperResponse.Success(request.Id, CollectionSnapshotBuilder.Scan()),
            "scan-transfer-stash" => ScanTransferStash(request),
            "inspect-write-safety" => HelperResponse.Success(request.Id, WriteSafetyGate.Inspect()),
            "inspect-live-game" => HelperResponse.Success(request.Id, liveGame.Inspect()),
            "start-live-game" => HelperResponse.Success(request.Id, liveGame.Start()),
            "poll-live-incoming" => HelperResponse.Success(request.Id, liveGame.PollIncoming()),
            "copy-live-incoming" => CopyLiveIncoming(request),
            "ack-live-incoming" => AcknowledgeLiveIncoming(request),
            "enqueue-live-retrieval" => EnqueueLiveRetrieval(request),
            "inspect-live-retrieval" => InspectLiveRetrieval(request),
            "self-test-write-transaction" => HelperResponse.Success(request.Id, WriteTransactionSelfTest.Run()),
            "self-test-live-queue" => HelperResponse.Success(request.Id, LiveGameAdapter.SelfTest()),
            "validate-transfer-stash-roundtrip" => ValidateTransferStashRoundTrip(request),
            "validate-ingest-plan" => ValidateIngestPlan(request),
            "plan-ingest-items" => PlanIngestItems(request),
            "commit-ingest-items" => CommitIngestItems(request),
            "plan-retrieve-items" => PlanRetrieveItems(request),
            "commit-retrieve-items" => CommitRetrieveItems(request),
            "validate-ingest-retrieval-roundtrip" => ValidateIngestRetrievalRoundTrip(request),
            "analyze-item-rolls" => AnalyzeItemRolls(request),
            _ => HelperResponse.Failure(request.Id, "method_not_found", $"Unknown method: {request.Method}")
        };
    }
    catch (Exception exception) when (exception is JsonException or NotSupportedException)
    {
        response = HelperResponse.Failure(request?.Id, "invalid_request", exception.Message);
    }
    catch (SourceChangedException exception)
    {
        response = HelperResponse.Failure(request?.Id, "source_changed", exception.Message);
    }
    catch (Exception exception) when (exception is ArgumentException or IOException or InvalidDataException or UnauthorizedAccessException)
    {
        response = HelperResponse.Failure(request?.Id, "scan_failed", exception.Message);
    }
    catch (WriteSafetyException exception)
    {
        response = HelperResponse.Failure(request?.Id, "write_blocked", exception.Message);
    }
    catch (Exception exception)
    {
        Console.Error.WriteLine(exception);
        response = HelperResponse.Failure(request?.Id, "internal_error", "The helper encountered an unexpected error.");
    }

    Console.WriteLine(JsonSerializer.Serialize(response, jsonOptions));
}

HelperResponse ScanTransferStash(HelperRequest request)
{
    var parameters = request.Params?.Deserialize<ScanTransferStashRequest>(jsonOptions)
        ?? throw new JsonException("scan-transfer-stash requires a path parameter.");
    return HelperResponse.Success(request.Id, TransferStashScanner.Scan(parameters.Path));
}

HelperResponse AcknowledgeLiveIncoming(HelperRequest request)
{
    var parameters = request.Params?.Deserialize<AcknowledgeLiveIncomingRequest>(jsonOptions)
        ?? throw new JsonException("ack-live-incoming requires path, expectedSha256, and receiptDirectory.");
    return HelperResponse.Success(
        request.Id,
        liveGame.AcknowledgeIncoming(
            parameters.Path,
            parameters.ExpectedSha256,
            parameters.ReceiptDirectory));
}

HelperResponse CopyLiveIncoming(HelperRequest request)
{
    var parameters = request.Params?.Deserialize<AcknowledgeLiveIncomingRequest>(jsonOptions)
        ?? throw new JsonException("copy-live-incoming requires path, expectedSha256, and receiptDirectory.");
    return HelperResponse.Success(
        request.Id,
        liveGame.CopyIncomingReceipt(
            parameters.Path,
            parameters.ExpectedSha256,
            parameters.ReceiptDirectory));
}

HelperResponse EnqueueLiveRetrieval(HelperRequest request)
{
    var parameters = request.Params?.Deserialize<EnqueueLiveRetrievalRequest>(jsonOptions)
        ?? throw new JsonException("enqueue-live-retrieval requires operationId, isHardcore, and item.");
    return HelperResponse.Success(
        request.Id,
        liveGame.EnqueueRetrieval(parameters.OperationId, parameters.IsHardcore, parameters.Item));
}

HelperResponse InspectLiveRetrieval(HelperRequest request)
{
    var parameters = request.Params?.Deserialize<InspectLiveRetrievalRequest>(jsonOptions)
        ?? throw new JsonException("inspect-live-retrieval requires queue.");
    return HelperResponse.Success(request.Id, liveGame.InspectRetrieval(parameters.Queue));
}

HelperResponse BuildItemCatalog(HelperRequest request)
{
    var parameters = request.Params?.Deserialize<BuildItemCatalogRequest>(jsonOptions)
        ?? throw new JsonException("build-item-catalog requires an installationPath parameter.");
    return HelperResponse.Success(request.Id, ItemCatalogBuilder.Build(parameters.InstallationPath));
}

HelperResponse InspectGameRecord(HelperRequest request)
{
    var parameters = request.Params?.Deserialize<InspectGameRecordRequest>(jsonOptions)
        ?? throw new JsonException("inspect-game-record requires installationPath and record parameters.");
    var data = ItemCatalogBuilder.Load(parameters.InstallationPath);
    if (!data.Records.TryGetValue(parameters.Record, out var source))
    {
        throw new ArgumentException($"Game record was not found: {parameters.Record}");
    }
    return HelperResponse.Success(request.Id, source.Record);
}

HelperResponse ExtractItemIcons(HelperRequest request)
{
    var parameters = request.Params?.Deserialize<ExtractItemIconsRequest>(jsonOptions)
        ?? throw new JsonException(
            "extract-item-icons requires installationPath, outputDirectory, and bitmaps parameters.");
    return HelperResponse.Success(
        request.Id,
        ItemIconExtractor.Extract(
            parameters.InstallationPath,
            parameters.OutputDirectory,
            parameters.Bitmaps));
}

HelperResponse ValidateTransferStashRoundTrip(HelperRequest request)
{
    var parameters = request.Params?.Deserialize<ValidateTransferStashRoundTripRequest>(jsonOptions)
        ?? throw new JsonException("validate-transfer-stash-roundtrip requires a path parameter.");
    return HelperResponse.Success(
        request.Id,
        TransferStashSerializer.ValidateRoundTrip(parameters.Path));
}

HelperResponse ValidateIngestPlan(HelperRequest request)
{
    var parameters = request.Params?.Deserialize<ValidateIngestPlanRequest>(jsonOptions)
        ?? throw new JsonException("validate-ingest-plan requires path, tabIndex, and itemIndex parameters.");
    return HelperResponse.Success(
        request.Id,
        IngestPlanner.Validate(parameters.Path, parameters.TabIndex, parameters.ItemIndex));
}

HelperResponse PlanIngestItems(HelperRequest request)
{
    var parameters = request.Params?.Deserialize<PlanIngestItemsRequest>(jsonOptions)
        ?? throw new JsonException("plan-ingest-items requires path and items parameters.");
    return HelperResponse.Success(
        request.Id,
        IngestPlanner.Plan(parameters.Path, parameters.Items));
}

HelperResponse CommitIngestItems(HelperRequest request)
{
    var parameters = request.Params?.Deserialize<CommitIngestItemsRequest>(jsonOptions)
        ?? throw new JsonException(
            "commit-ingest-items requires operationId, path, expectedSourceSha256, items, and backupDirectory parameters.");
    return HelperResponse.Success(
        request.Id,
        IngestPlanner.Commit(
            parameters.OperationId,
            parameters.Path,
            parameters.ExpectedSourceSha256,
            parameters.Items,
            parameters.BackupDirectory));
}

HelperResponse PlanRetrieveItems(HelperRequest request)
{
    var parameters = request.Params?.Deserialize<PlanRetrieveItemsRequest>(jsonOptions)
        ?? throw new JsonException("plan-retrieve-items requires path, targetTabIndex, and items parameters.");
    return HelperResponse.Success(
        request.Id,
        RetrievalPlanner.Plan(parameters.Path, parameters.TargetTabIndex, parameters.Items));
}

HelperResponse CommitRetrieveItems(HelperRequest request)
{
    var parameters = request.Params?.Deserialize<CommitRetrieveItemsRequest>(jsonOptions)
        ?? throw new JsonException(
            "commit-retrieve-items requires operationId, path, expectedSourceSha256, targetTabIndex, items, and backupDirectory parameters.");
    return HelperResponse.Success(
        request.Id,
        RetrievalPlanner.Commit(
            parameters.OperationId,
            parameters.Path,
            parameters.ExpectedSourceSha256,
            parameters.TargetTabIndex,
            parameters.Items,
            parameters.BackupDirectory));
}

HelperResponse ValidateIngestRetrievalRoundTrip(HelperRequest request)
{
    var parameters = request.Params?.Deserialize<ValidateIngestRetrievalRoundTripRequest>(jsonOptions)
        ?? throw new JsonException(
            "validate-ingest-retrieval-roundtrip requires path, tabIndex, and itemIndex parameters.");
    return HelperResponse.Success(
        request.Id,
        RetrievalPlanner.ValidateInMemoryRoundTrip(
            parameters.Path,
            parameters.TabIndex,
            parameters.ItemIndex));
}

HelperResponse AnalyzeItemRolls(HelperRequest request)
{
    var parameters = request.Params?.Deserialize<AnalyzeItemRollsRequest>(jsonOptions)
        ?? throw new JsonException("analyze-item-rolls requires installationPath and items parameters.");
    return HelperResponse.Success(
        request.Id,
        ItemRollAnalyzer.Analyze(parameters.InstallationPath, parameters.Items));
}

internal sealed record BuildItemCatalogRequest(string InstallationPath);
internal sealed record InspectGameRecordRequest(string InstallationPath, string Record);
internal sealed record AcknowledgeLiveIncomingRequest(
    string Path,
    string ExpectedSha256,
    string ReceiptDirectory);
internal sealed record EnqueueLiveRetrievalRequest(
    string OperationId,
    bool IsHardcore,
    VaultItemPayload Item);
internal sealed record InspectLiveRetrievalRequest(LiveRetrievalQueue Queue);

internal sealed record HelperRequest(string Id, string Method, JsonElement? Params);

internal sealed record HelperError(string Code, string Message);

internal sealed record HelperResponse(string? Id, object? Result, HelperError? Error)
{
    public static HelperResponse Success(string id, object result) => new(id, result, null);

    public static HelperResponse Failure(string? id, string code, string message) =>
        new(id, null, new HelperError(code, message));
}
