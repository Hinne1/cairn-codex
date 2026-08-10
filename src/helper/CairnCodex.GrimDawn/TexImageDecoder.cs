using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

namespace CairnCodex.GrimDawn;

internal static class TexImageDecoder
{
    private delegate int[] BlockDecoder(ReadOnlySpan<byte> block);
    private const int Dxt1 = 0x31545844;
    private const int Dxt3 = 0x33545844;
    private const int Dxt5 = 0x35545844;

    public static void SavePng(byte[] texture, string destination)
    {
        if (texture.Length < 12) throw new InvalidDataException("TEX payload is truncated.");
        var ddsLength = BitConverter.ToInt32(texture, 8);
        if (ddsLength < 128 || ddsLength > texture.Length - 12)
        {
            throw new InvalidDataException("TEX payload contains an invalid DDS length.");
        }
        var dds = texture.AsSpan(12, ddsLength);
        if (dds[0] != (byte)'D' || dds[1] != (byte)'D' || dds[2] != (byte)'S')
        {
            throw new InvalidDataException("TEX payload does not contain a DDS image.");
        }

        var height = ReadInt32(dds, 12);
        var width = ReadInt32(dds, 16);
        if (width <= 0 || height <= 0 || width > 512 || height > 512)
        {
            throw new InvalidDataException($"Unsupported item icon dimensions: {width}x{height}.");
        }

        var fourCc = ReadInt32(dds, 84);
        var pixels = fourCc switch
        {
            Dxt1 => DecodeDxt(dds[128..], width, height, 8, DecodeDxt1),
            Dxt3 => DecodeDxt(dds[128..], width, height, 16, DecodeDxt3),
            Dxt5 => DecodeDxt(dds[128..], width, height, 16, DecodeDxt5),
            _ when ReadInt32(dds, 88) == 32 => DecodeBgra32(dds[128..], width, height),
            _ => throw new InvalidDataException($"Unsupported item icon DDS format: 0x{fourCc:X8}.")
        };

        using var bitmap = new Bitmap(width, height, PixelFormat.Format32bppArgb);
        var bounds = new Rectangle(0, 0, width, height);
        var data = bitmap.LockBits(bounds, ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
        try
        {
            for (var y = 0; y < height; y++)
            {
                Marshal.Copy(pixels, y * width, data.Scan0 + y * data.Stride, width);
            }
        }
        finally
        {
            bitmap.UnlockBits(data);
        }
        bitmap.Save(destination, ImageFormat.Png);
    }

    private static int[] DecodeDxt(
        ReadOnlySpan<byte> data,
        int width,
        int height,
        int blockSize,
        BlockDecoder decodeBlock)
    {
        var blockColumns = (width + 3) / 4;
        var blockRows = (height + 3) / 4;
        var expected = checked(blockColumns * blockRows * blockSize);
        if (data.Length < expected) throw new InvalidDataException("DDS block data is truncated.");
        var pixels = new int[checked(width * height)];
        var offset = 0;
        for (var blockY = 0; blockY < blockRows; blockY++)
        {
            for (var blockX = 0; blockX < blockColumns; blockX++)
            {
                var block = decodeBlock(data.Slice(offset, blockSize));
                offset += blockSize;
                for (var y = 0; y < 4; y++)
                for (var x = 0; x < 4; x++)
                {
                    var px = blockX * 4 + x;
                    var py = blockY * 4 + y;
                    if (px < width && py < height) pixels[py * width + px] = block[y * 4 + x];
                }
            }
        }
        return pixels;
    }

    private static int[] DecodeDxt1(ReadOnlySpan<byte> block) => DecodeColorBlock(block, false, null);

    private static int[] DecodeDxt3(ReadOnlySpan<byte> block)
    {
        var alpha = new byte[16];
        for (var index = 0; index < 16; index++)
        {
            var nibble = (block[index / 2] >> ((index & 1) * 4)) & 0xF;
            alpha[index] = (byte)(nibble * 17);
        }
        return DecodeColorBlock(block[8..], true, alpha);
    }

    private static int[] DecodeDxt5(ReadOnlySpan<byte> block)
    {
        var palette = BuildAlphaPalette(block[0], block[1]);
        ulong indices = 0;
        for (var index = 0; index < 6; index++) indices |= (ulong)block[2 + index] << (8 * index);
        var alpha = new byte[16];
        for (var index = 0; index < 16; index++)
            alpha[index] = palette[(int)((indices >> (3 * index)) & 7)];
        return DecodeColorBlock(block[8..], true, alpha);
    }

    private static byte[] BuildAlphaPalette(byte first, byte second)
    {
        var result = new byte[8];
        result[0] = first;
        result[1] = second;
        if (first > second)
        {
            for (var index = 1; index <= 6; index++)
                result[index + 1] = (byte)(((7 - index) * first + index * second) / 7);
        }
        else
        {
            for (var index = 1; index <= 4; index++)
                result[index + 1] = (byte)(((5 - index) * first + index * second) / 5);
            result[6] = 0;
            result[7] = 255;
        }
        return result;
    }

    private static int[] DecodeColorBlock(ReadOnlySpan<byte> block, bool forceFourColor, byte[]? alpha)
    {
        var first = (ushort)(block[0] | block[1] << 8);
        var second = (ushort)(block[2] | block[3] << 8);
        var colors = new int[4];
        colors[0] = Expand565(first, 255);
        colors[1] = Expand565(second, 255);
        if (first > second || forceFourColor)
        {
            colors[2] = Mix(colors[0], colors[1], 2, 1, 3);
            colors[3] = Mix(colors[0], colors[1], 1, 2, 3);
        }
        else
        {
            colors[2] = Mix(colors[0], colors[1], 1, 1, 2);
            colors[3] = 0;
        }

        var indices = (uint)(block[4] | block[5] << 8 | block[6] << 16 | block[7] << 24);
        var result = new int[16];
        for (var index = 0; index < 16; index++)
        {
            var color = colors[(indices >> (index * 2)) & 3];
            var a = alpha?[index] ?? (byte)((color >> 24) & 0xFF);
            result[index] = (color & 0x00FFFFFF) | a << 24;
        }
        return result;
    }

    private static int[] DecodeBgra32(ReadOnlySpan<byte> data, int width, int height)
    {
        var length = checked(width * height * 4);
        if (data.Length < length) throw new InvalidDataException("DDS pixel data is truncated.");
        var result = new int[width * height];
        for (var index = 0; index < result.Length; index++) result[index] = ReadInt32(data, index * 4);
        return result;
    }

    private static int Expand565(ushort value, byte alpha)
    {
        var r = (value >> 11) & 31;
        var g = (value >> 5) & 63;
        var b = value & 31;
        r = (r << 3) | (r >> 2);
        g = (g << 2) | (g >> 4);
        b = (b << 3) | (b >> 2);
        return alpha << 24 | r << 16 | g << 8 | b;
    }

    private static int Mix(int first, int second, int firstWeight, int secondWeight, int divisor)
    {
        var r = (((first >> 16) & 0xFF) * firstWeight + ((second >> 16) & 0xFF) * secondWeight) / divisor;
        var g = (((first >> 8) & 0xFF) * firstWeight + ((second >> 8) & 0xFF) * secondWeight) / divisor;
        var b = ((first & 0xFF) * firstWeight + (second & 0xFF) * secondWeight) / divisor;
        return unchecked((int)0xFF000000) | r << 16 | g << 8 | b;
    }

    private static int ReadInt32(ReadOnlySpan<byte> data, int offset) =>
        data[offset] | data[offset + 1] << 8 | data[offset + 2] << 16 | data[offset + 3] << 24;
}
