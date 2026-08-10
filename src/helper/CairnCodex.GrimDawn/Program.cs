using System.Text.Json;
using System.Text.Json.Serialization;
using CairnCodex.GrimDawn;

const int ProtocolVersion = 1;
var jsonOptions = new JsonSerializerOptions
{
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
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
            "scan-collection" => HelperResponse.Success(request.Id, CollectionSnapshotBuilder.Scan()),
            "scan-transfer-stash" => ScanTransferStash(request),
            _ => HelperResponse.Failure(request.Id, "method_not_found", $"Unknown method: {request.Method}")
        };
    }
    catch (Exception exception) when (exception is JsonException or NotSupportedException)
    {
        response = HelperResponse.Failure(request?.Id, "invalid_request", exception.Message);
    }
    catch (Exception exception) when (exception is ArgumentException or IOException or InvalidDataException or UnauthorizedAccessException)
    {
        response = HelperResponse.Failure(request?.Id, "scan_failed", exception.Message);
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

HelperResponse BuildItemCatalog(HelperRequest request)
{
    var parameters = request.Params?.Deserialize<BuildItemCatalogRequest>(jsonOptions)
        ?? throw new JsonException("build-item-catalog requires an installationPath parameter.");
    return HelperResponse.Success(request.Id, ItemCatalogBuilder.Build(parameters.InstallationPath));
}

internal sealed record BuildItemCatalogRequest(string InstallationPath);

internal sealed record HelperRequest(string Id, string Method, JsonElement? Params);

internal sealed record HelperError(string Code, string Message);

internal sealed record HelperResponse(string? Id, object? Result, HelperError? Error)
{
    public static HelperResponse Success(string id, object result) => new(id, result, null);

    public static HelperResponse Failure(string? id, string code, string message) =>
        new(id, null, new HelperError(code, message));
}
