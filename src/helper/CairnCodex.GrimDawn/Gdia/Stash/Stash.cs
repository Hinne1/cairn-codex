using System;
// Derived from Grim Dawn Item Assistant at the commit recorded in docs/upstream/gdia.md.
using System.Collections.Generic;
using IAGrim.Parser.Stash;

namespace IAGrim.StashFile {
    public class Stash {
        public const int UNKNOWN1 = 2;

        public const int BLOCK_RESULT = 18;

        public const int CURRENT_VERSION = 4;

        public const int UNKNOWN2 = 0;

        public Block Block = new Block();

        public uint Unknown1 = 2u;

        public uint Version = 4u;

        public uint Unknown2 = 0u;

        public string ModLabel = "";

        public bool IsExpansion1 = false;

        public List<StashTab> Tabs = new List<StashTab>();

        public string? LastError { get; private set; }

        public uint Width {
            get {
                if (Tabs.Count > 0)
                    return Tabs[0].Width;
                else
                    return 0;
            }
        }

        public uint Height {
            get {
                if (Tabs.Count > 0)
                    return Tabs[0].Height;
                else
                    return 0;
            }
        }

        public void Write(DataBuffer pBuffer) {
            pBuffer.WriteUInt(0x55555555);
            pBuffer.WriteUInt(this.Unknown1);
            this.Block.WriteStart(0x12, pBuffer);
            pBuffer.WriteUInt(this.Version);
            pBuffer.WriteUInt(this.Unknown2);
            pBuffer.WriteString(this.ModLabel);
            if (this.Version >= 5) {
                pBuffer.WriteBoolean(this.IsExpansion1);
            }
            if ((this.Tabs == null) || (this.Tabs.Count < 1)) {
                pBuffer.WriteUInt(0);
            }
            else {
                pBuffer.WriteUInt((uint)this.Tabs.Count);
                for (int i = 0; i < this.Tabs.Count; i++) {
                    this.Tabs[i].Write(pBuffer);
                }
            }
            this.Block.WriteEnd(pBuffer);
        }

        public bool Read(GDCryptoDataBuffer pCrypto) {
            LastError = null;
            if (!pCrypto.ReadCryptoKey())
                return false;

            bool result;
            if (!pCrypto.ReadCryptoUInt(out this.Unknown1) || this.Unknown1 != 2u) {
                LastError = $"Expected transfer stash marker 2, got {this.Unknown1}.";
                return false;
            }

            if (!Block.ReadStart(out this.Block, pCrypto) || this.Block.Result != 18u) {
                return false;
            }

            if (!pCrypto.ReadCryptoUInt(out this.Version) || (this.Version != 5u && this.Version != 4u && this.Version != 8u && this.Version != 9u && this.Version != 11u)) {
                LastError = $"Unsupported transfer stash version {this.Version}.";
                return false;
            }

            if (!pCrypto.ReadNextCryptoUInt(out this.Unknown2) || this.Unknown2 != 0u)
                return false;

            if (!pCrypto.ReadCryptoString(out this.ModLabel))
                return false;
            
            
            if (this.Version >= 5) {
                if (!pCrypto.ReadCryptoBool(out IsExpansion1)) {
                    LastError = $"Could not parse expansion flag for transfer stash version {this.Version}.";
                    return false;
                }
            }

            uint numStashTabs = 0u;
            if (!pCrypto.ReadCryptoUInt(out numStashTabs) || numStashTabs > 100)
                return false;


            this.Tabs = new List<StashTab>();
            int num2 = 0;
            while ((long)num2 < (long)((ulong)numStashTabs)) {
                StashTab stashTab = new StashTab(this.Version);
                bool flag6 = !stashTab.Read(pCrypto, this.Version);
                if (flag6) {
                    LastError = $"Could not parse tab {num2}: {stashTab.LastError ?? $"offset {pCrypto.Cursor}"}";
                    result = false;
                    return result;
                }
                this.Tabs.Add(stashTab);
                num2++;
            }
            bool flag7 = !this.Block.ReadEnd(pCrypto);
            if (flag7) {
                LastError = $"Stash block ended at offset {pCrypto.Cursor}, expected {this.Block.End}.";
            }
            result = !flag7;

            return result;
        }

        
    }
}
