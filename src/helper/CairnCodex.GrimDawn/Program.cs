using System.Diagnostics;
using System.Text.Json;
using CairnCodex.GrimDawn;
using CairnCodex.GrimDawn.Gdia.GameData;

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
            "measure-memory" => MeasureMemory(request),
            "discover-grim-dawn" => HelperResponse.Success(request.Id, GrimDawnDiscovery.Discover()),
            "discover-grim-dawn-at" => HelperResponse.Success(
                request.Id,
                GrimDawnDiscovery.Discover(
                    request.Params?.Deserialize<GrimDawnDiscoveryRequest>(jsonOptions)
                    ?? throw new ArgumentException("Discovery roots are required."))),
            "inspect-content-packs" => HelperResponse.Success(
                request.Id,
                ItemCatalogBuilder.InspectContentPacks(
                    request.Params?.Deserialize<BuildItemCatalogRequest>(jsonOptions)?.InstallationPath
                    ?? throw new ArgumentException("An installation path is required."))),
            "list-characters" => ListCharacters(request),
            "build-item-catalog" => BuildItemCatalog(request),
            "simulate-dismantling" => SimulateDismantling(request),
            "resolve-archive-items" => ResolveArchiveItems(request),
            "inspect-game-record" => InspectGameRecord(request),
            "inspect-game-records" => InspectGameRecords(request),
            "inspect-set-presentations" => InspectSetPresentations(request),
            "inspect-archive-text" => InspectArchiveText(request),
            "build-map-location-index" => BuildMapLocationIndex(request),
            "extract-item-icons" => ExtractItemIcons(request),
            "scan-collection" => HelperResponse.Success(request.Id, CollectionSnapshotBuilder.Scan()),
            "scan-transfer-stash" => ScanTransferStash(request),
            "inspect-write-safety" => HelperResponse.Success(request.Id, WriteSafetyGate.Inspect()),
            "inspect-live-game" => HelperResponse.Success(request.Id, liveGame.Inspect()),
            "approve-live-game-build" => HelperResponse.Success(request.Id, liveGame.ApproveCurrentBuild()),
            "start-live-game" => HelperResponse.Success(request.Id, liveGame.Start()),
            "stop-live-game" => HelperResponse.Success(request.Id, liveGame.Stop()),
            "poll-live-incoming" => HelperResponse.Success(request.Id, liveGame.PollIncoming()),
            "copy-live-incoming" => CopyLiveIncoming(request),
            "ack-live-incoming" => AcknowledgeLiveIncoming(request),
            "enqueue-live-retrieval" => EnqueueLiveRetrieval(request),
            "inspect-live-retrieval" => InspectLiveRetrieval(request),
            "self-test-write-transaction" => HelperResponse.Success(request.Id, WriteTransactionSelfTest.Run()),
            "self-test-live-queue" => HelperResponse.Success(request.Id, LiveGameAdapter.SelfTest()),
            "self-test-dismantling" => HelperResponse.Success(request.Id, DismantlingSimulatorSelfTest.Run()),
            "self-test-acquisition" => HelperResponse.Success(request.Id, AcquisitionResolverSelfTest.Run()),
            "self-test-item-presentation" => HelperResponse.Success(request.Id, ItemPresentationBuilderSelfTest.Run()),
            "self-test-roll-ratings" => HelperResponse.Success(request.Id, ItemRollRatingSelfTest.Run()),
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

HelperResponse MeasureMemory(HelperRequest request)
{
    var parameters = request.Params?.Deserialize<MeasureMemoryRequest>(jsonOptions)
        ?? new MeasureMemoryRequest(false);
    if (parameters.Collect)
    {
        GC.Collect();
        GC.WaitForPendingFinalizers();
        GC.Collect();
    }
    using var process = Process.GetCurrentProcess();
    var gc = GC.GetGCMemoryInfo();
    return HelperResponse.Success(request.Id, new
    {
        processId = Environment.ProcessId,
        workingSetBytes = process.WorkingSet64,
        privateBytes = process.PrivateMemorySize64,
        managedHeapBytes = GC.GetTotalMemory(false),
        managedCommittedBytes = gc.TotalCommittedBytes,
        collectionForced = parameters.Collect
    });
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
        liveGame.EnqueueRetrieval(
            parameters.OperationId,
            parameters.IsHardcore,
            parameters.Item,
            parameters.Destination));
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

HelperResponse SimulateDismantling(HelperRequest request)
{
    var parameters = request.Params?.Deserialize<SimulateDismantlingRequest>(jsonOptions)
        ?? throw new JsonException("simulate-dismantling requires installationPath and items parameters.");
    return HelperResponse.Success(
        request.Id,
        DismantlingSimulator.Simulate(parameters.InstallationPath, parameters.Items));
}

HelperResponse ResolveArchiveItems(HelperRequest request)
{
    var parameters = request.Params?.Deserialize<ResolveArchiveItemsRequest>(jsonOptions)
        ?? throw new JsonException("resolve-archive-items requires installationPath and records parameters.");
    return HelperResponse.Success(
        request.Id,
        ItemCatalogBuilder.ResolveArchiveItems(parameters.InstallationPath, parameters.Records));
}

HelperResponse ListCharacters(HelperRequest request)
{
    var parameters = request.Params?.Deserialize<BuildItemCatalogRequest>(jsonOptions)
        ?? throw new JsonException("list-characters requires an installationPath parameter.");
    return HelperResponse.Success(request.Id, CharacterSaveReader.Discover(parameters.InstallationPath));
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

HelperResponse InspectGameRecords(HelperRequest request)
{
    var parameters = request.Params?.Deserialize<InspectGameRecordsRequest>(jsonOptions)
        ?? throw new JsonException("inspect-game-records requires an installationPath parameter.");
    var data = ItemCatalogBuilder.Load(parameters.InstallationPath);
    var limit = Math.Clamp(parameters.Limit, 1, 5000);
    var fields = parameters.Fields ?? [];
    var includeAllFields = fields.Any(field => field == "*");
    var matches = data.Records.Values
        .Where(source => string.IsNullOrWhiteSpace(parameters.RecordContains) ||
            source.Record.Name.Contains(parameters.RecordContains, StringComparison.OrdinalIgnoreCase))
        .Where(source => string.IsNullOrWhiteSpace(parameters.Type) ||
            string.Equals(source.Record.Type, parameters.Type, StringComparison.OrdinalIgnoreCase))
        .Where(source => string.IsNullOrWhiteSpace(parameters.ValueContains) ||
            source.Record.Values.Values.SelectMany(values => values).Any(value =>
                value.Text?.Contains(parameters.ValueContains, StringComparison.OrdinalIgnoreCase) == true ||
                value.Text is { } tag && data.Tags.TryGetValue(tag, out var resolved) &&
                resolved.Contains(parameters.ValueContains, StringComparison.OrdinalIgnoreCase)))
        .Where(source => string.IsNullOrWhiteSpace(parameters.Field) ||
            source.Record.Values.TryGetValue(parameters.Field, out var values) &&
            (string.IsNullOrWhiteSpace(parameters.ValueEquals) || values.Any(value =>
                string.Equals(value.Text, parameters.ValueEquals, StringComparison.OrdinalIgnoreCase) ||
                string.Equals(value.Number?.ToString(System.Globalization.CultureInfo.InvariantCulture),
                    parameters.ValueEquals, StringComparison.OrdinalIgnoreCase))))
        .OrderBy(source => source.Record.Name, StringComparer.OrdinalIgnoreCase)
        .Take(limit)
        .Select(source => new
        {
            record = source.Record.Name,
            source.Record.Type,
            source.ContentPack,
            matchingText = string.IsNullOrWhiteSpace(parameters.ValueContains)
                ? []
                : source.Record.Values.Values
                    .SelectMany(values => values)
                    .Select(value => value.Text)
                    .Where(value => value?.Contains(
                        parameters.ValueContains,
                        StringComparison.OrdinalIgnoreCase) == true)
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToArray(),
            fields = (includeAllFields ? source.Record.Values.Keys : fields).ToDictionary(
                field => field,
                field => source.Record.Values.GetValueOrDefault(field) ?? [],
                StringComparer.OrdinalIgnoreCase),
            resolvedText = (includeAllFields ? source.Record.Values.Keys : fields).ToDictionary(
                field => field,
                field => source.Record.Values.GetValueOrDefault(field)?
                    .Select(value => value.Text is { } text && data.Tags.TryGetValue(text, out var resolved)
                        ? resolved
                        : value.Text)
                    .Where(value => value is not null)
                    .ToArray() ?? [],
                StringComparer.OrdinalIgnoreCase)
        })
        .ToArray();
    return HelperResponse.Success(request.Id, new { count = matches.Length, records = matches });
}

HelperResponse InspectSetPresentations(HelperRequest request)
{
    var parameters = request.Params?.Deserialize<BuildItemCatalogRequest>(jsonOptions)
        ?? throw new JsonException("inspect-set-presentations requires an installationPath parameter.");
    var data = ItemCatalogBuilder.Load(parameters.InstallationPath);
    var presentationSource = new ItemPresentationSource(data.Tags, data.Records);
    var sets = data.Records.Values
        .Select(source => source.Record.Text("itemSetName"))
        .OfType<string>()
        .Distinct(StringComparer.OrdinalIgnoreCase)
        .Select(path => new
        {
            record = path,
            presentation = ItemPresentationBuilder.BuildSet(path, presentationSource)
        })
        .Where(set => set.presentation is not null)
        .OrderBy(set => set.presentation!.Name, StringComparer.OrdinalIgnoreCase)
        .ToArray();
    return HelperResponse.Success(request.Id, new { count = sets.Length, sets });
}

HelperResponse InspectArchiveText(HelperRequest request)
{
    var parameters = request.Params?.Deserialize<InspectArchiveTextRequest>(jsonOptions)
        ?? throw new JsonException("inspect-archive-text requires archivePath, entryPath, and text parameters.");
    return HelperResponse.Success(
        request.Id,
        ArcArchiveReader.SearchText(
            parameters.ArchivePath,
            parameters.EntryPath,
            parameters.Text,
            parameters.ContextBytes,
            parameters.Limit));
}

HelperResponse BuildMapLocationIndex(HelperRequest request)
{
    var parameters = request.Params?.Deserialize<BuildItemCatalogRequest>(jsonOptions)
        ?? throw new JsonException("build-map-location-index requires an installationPath parameter.");
    return HelperResponse.Success(request.Id, MapLocationIndexer.Build(parameters.InstallationPath));
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
internal sealed record MeasureMemoryRequest(bool Collect);
internal sealed record SimulateDismantlingRequest(
    string InstallationPath,
    DismantlingInputItem[] Items);
internal sealed record ResolveArchiveItemsRequest(string InstallationPath, string[] Records);
internal sealed record InspectGameRecordRequest(string InstallationPath, string Record);
internal sealed record InspectArchiveTextRequest(
    string ArchivePath,
    string EntryPath,
    string Text,
    int ContextBytes = 32768,
    int Limit = 20);
internal sealed record InspectGameRecordsRequest(
    string InstallationPath,
    string? RecordContains,
    string? Type,
    string? ValueContains,
    string? Field,
    string? ValueEquals,
    string[]? Fields,
    int Limit = 100);
internal sealed record AcknowledgeLiveIncomingRequest(
    string Path,
    string ExpectedSha256,
    string ReceiptDirectory);
internal sealed record EnqueueLiveRetrievalRequest(
    string OperationId,
    bool IsHardcore,
    VaultItemPayload Item,
    string Destination = "shared-stash");
internal sealed record InspectLiveRetrievalRequest(LiveRetrievalQueue Queue);

internal sealed record HelperRequest(string Id, string Method, JsonElement? Params);

internal sealed record HelperError(string Code, string Message);

internal sealed record HelperResponse(string? Id, object? Result, HelperError? Error)
{
    public static HelperResponse Success(string id, object result) => new(id, result, null);

    public static HelperResponse Failure(string? id, string code, string message) =>
        new(id, null, new HelperError(code, message));
}
