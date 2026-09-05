import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, rm, stat, unlink, writeFile } from "node:fs/promises";
import { app } from "electron";
import { type CharacterSaveProfile, type CollectionSnapshot } from "@shared/contracts";
import { isCollectionOwned, withAwakeningAvailability } from "@shared/collection-availability";
import { withRecipeCollection, type LiveVaultPayload } from "../main/collection-presentation.ts";
import { GrimDawnHelperClient } from "../main/grim-dawn/helper-client";
import { CollectionDatabase, type ResolvedArchiveCatalogItem } from "../main/collection-database";
import { ArchiveBackupService } from "../main/archive-backup";
import { DiagnosticLogger } from "../main/diagnostics";
import { ROLL_ANALYSIS_VERSION } from '../main/catalog-versions.ts'
import type { MapLocationIndex } from '../main/bootstrap.ts'
import { reconcileLiveRecoveryOperations } from '../main/transfers/retained-receipts.ts'
import { syncLiveIncoming } from '../main/transfers/live-incoming.ts'
import { systemTransferClock, type HelperRequester } from '../main/transfers/runtime.ts'
import type { LiveIncomingItem, LiveRetrievalQueue, LiveRetrievalStatus } from '../main/transfers/contracts.ts'

export async function runSmokeTest(
  helper: GrimDawnHelperClient,
  database: CollectionDatabase,
  diagnostics: DiagnosticLogger
): Promise<void> {
  try {
    const schemaSmokePath = join(
      app.getPath('temp'),
      `cairn-codex-schema-smoke-${randomUUID()}.sqlite3`
    )
    try {
      new CollectionDatabase(schemaSmokePath).close()
      new CollectionDatabase(schemaSmokePath).close()
    } finally {
      await Promise.all(
        [schemaSmokePath, `${schemaSmokePath}-wal`, `${schemaSmokePath}-shm`].map((path) =>
          unlink(path).catch(() => undefined)
        )
      )
    }
    const archiveSmokeRoot = join(
      app.getPath('temp'),
      `cairn-codex-archive-backup-smoke-${randomUUID()}`
    )
    const archiveSmokePath = join(archiveSmokeRoot, 'archive.sqlite3')
    const archiveSmokeBackupDirectory = join(archiveSmokeRoot, 'backups')
    try {
      await mkdir(archiveSmokeRoot, { recursive: true })
      const archiveSmokeDatabase = new CollectionDatabase(archiveSmokePath)
      const archiveSmokeService = new ArchiveBackupService(
        archiveSmokeDatabase,
        archiveSmokePath,
        archiveSmokeBackupDirectory,
        2
      )
      const original = await archiveSmokeService.createBackup('smoke original')
      archiveSmokeDatabase.setInfiniteSupplies(false)
      await archiveSmokeService.createBackup('smoke changed')
      await archiveSmokeService.stageRestore(
        join(archiveSmokeBackupDirectory, original.fileName)
      )
      archiveSmokeDatabase.close()
      if (!(await ArchiveBackupService.applyPendingRestore(
        archiveSmokePath,
        archiveSmokeBackupDirectory
      ))) {
        throw new Error('Archive backup smoke test did not apply its staged restore.')
      }
      const restoredArchive = new CollectionDatabase(archiveSmokePath)
      try {
        if (!restoredArchive.getInfiniteSupplies()) {
          throw new Error('Archive restore did not recover the selected database state.')
        }
      } finally {
        restoredArchive.close()
      }
      const archiveStatus = await archiveSmokeService.getStatus()
      if (
        archiveStatus.pendingRestore ||
        archiveStatus.backups.length < 2 ||
        !archiveStatus.backups.every((entry) => entry.verified && /^[0-9a-f]{64}$/.test(entry.sha256))
      ) {
        throw new Error('Archive backup rotation or verification metadata failed its smoke test.')
      }
      await writeFile(
        join(archiveSmokeBackupDirectory, 'pending-restore.json'),
        `${JSON.stringify({
          sourcePath: join(archiveSmokeBackupDirectory, 'missing.sqlite3'),
          sourceSha256: '0'.repeat(64),
          requestedAtUtc: new Date().toISOString()
        }, null, 2)}\n`,
        'utf8'
      )
      let invalidRestoreRejected = false
      try {
        await ArchiveBackupService.applyPendingRestore(
          archiveSmokePath,
          archiveSmokeBackupDirectory
        )
      } catch {
        invalidRestoreRejected = true
      }
      const quarantinedRestore = await ArchiveBackupService.quarantinePendingRestore(
        archiveSmokeBackupDirectory
      )
      if (!invalidRestoreRejected || !quarantinedRestore) {
        throw new Error('Invalid staged restore did not fail closed and leave the current archive usable.')
      }
      await stat(quarantinedRestore)
      new CollectionDatabase(archiveSmokePath).close()
    } finally {
      await rm(archiveSmokeRoot, { recursive: true, force: true })
    }
    await helper.request('health')
    const writeTransaction = await helper.request<{ passed: boolean }>('self-test-write-transaction')
    if (!writeTransaction.passed) {
      throw new Error('Verified write transaction self-test failed.')
    }
    const liveQueue = await helper.request<{
      passed: boolean
      fields: number
      hookSha256: string
      injectorSha256: string
      offlineRecoveryPassed: boolean
      staleReceiptRejected: boolean
      queuePathGuardPassed: boolean
      multiItemPassed: boolean
      unsupportedBuildRejected: boolean
    }>('self-test-live-queue')
    if (
      !liveQueue.passed ||
      liveQueue.fields !== 18 ||
      !/^[0-9a-f]{64}$/.test(liveQueue.hookSha256) ||
      !/^[0-9a-f]{64}$/.test(liveQueue.injectorSha256) ||
      !liveQueue.offlineRecoveryPassed ||
      !liveQueue.staleReceiptRejected ||
      !liveQueue.queuePathGuardPassed ||
      !liveQueue.multiItemPassed ||
      !liveQueue.unsupportedBuildRejected
    ) {
      throw new Error('Live queue serializer self-test failed.')
    }
    const helperSnapshot = await helper.request<CollectionSnapshot>('scan-collection')
    const installationPath = helperSnapshot.discovery.installations[0]?.path
    if (!installationPath) throw new Error('Grim Dawn installation was not discovered.')
    const quarantineResolution = await helper.request<ResolvedArchiveCatalogItem[]>(
      'resolve-archive-items',
      {
        installationPath,
        records: [
          'records/items/gearaccessories/medals/b204a_medal.dbr',
          'records/items/gearshoulders/a09_shoulder02.dbr'
        ]
      }
    )
    const rareResolution = quarantineResolution.find((item) =>
      item.record.endsWith('/b204a_medal.dbr')
    )
    const genericResolution = quarantineResolution.find((item) =>
      item.record.endsWith('/a09_shoulder02.dbr')
    )
    if (
      rareResolution?.name !== "Brawler's Distinction" ||
      !rareResolution.catalogEligible ||
      genericResolution?.name !== 'Exalted Shoulderplates' ||
      genericResolution.catalogEligible
    ) {
      throw new Error('Installed-data quarantine classification did not preserve archive boundaries.')
    }
    const supplies = helperSnapshot.supplies ?? []
    const materials = helperSnapshot.materials ?? []
    const writ = supplies.find((item) => item.slot === 'writ')
    const mandate = supplies.find((item) => item.slot === 'mandate')
    const warrant = supplies.find((item) => item.slot === 'warrant')
    const merits = supplies.filter((item) => item.slot === 'merit')
    const saviorsMerit = merits.find((item) => item.name === "Savior's Merit")
    const clarityPotion = supplies.find((item) =>
      item.record.toLocaleLowerCase().endsWith('/xppotion_malmouth.dbr')
    )
    const augment = supplies.find((item) => item.slot === 'augment')
    const movementRune = supplies.find((item) => item.slot === 'rune')
    if (
      supplies.length < 300 ||
      supplies.some((item) => item.rarity !== 'supply') ||
      !writ ||
      !mandate ||
      !warrant ||
      merits.length !== 4 ||
      !saviorsMerit?.bitmap?.endsWith('/difficulty_legendaryunlock.tex') ||
      !saviorsMerit.presentation?.sections.some((section) =>
        section.lines.some((line) => line.label === 'Unlocks Ultimate difficulty')
      ) ||
      clarityPotion?.slot !== 'potion' ||
      !clarityPotion.presentation?.grantedSkill?.lines.some(
        (line) => line.label === 'Experience Gained' && line.minimum === 100
      ) ||
      !augment ||
      !movementRune
    ) {
      throw new Error('Reusable supply catalog did not include faction boosts, merits, Potion of Clarity, augments, and movement runes.')
    }
    if (
      materials.filter((item) => item.rarity === 'component').length < 40 ||
      !materials.some((item) => item.record.toLocaleLowerCase().endsWith('/quest_dynamite.dbr')) ||
      !materials.some((item) => item.slot === 'potion-formula')
    ) {
      throw new Error('Component and consumable account stores were not indexed.')
    }
    const characterProfiles = await helper.request<CharacterSaveProfile[]>('list-characters', {
      installationPath: helperSnapshot.discovery.installations[0]?.path
    })
    const sanya = characterProfiles.find((profile) => profile.name === 'Sanya' && !profile.error)
    if (
      characterProfiles.length === 0 ||
      characterProfiles.some((profile) => profile.error) ||
      !sanya?.skills.some((skill) => skill.name === 'Devouring Swarm' && skill.level > 0) ||
      !sanya.factions.some((faction) => faction.name === 'Devil\'s Crossing')
    ) {
      throw new Error('Read-only character loading did not validate current local and cloud saves.')
    }
    const factionPlannerItems = helperSnapshot.plannerItems ?? []
    const chosenArcanespark = factionPlannerItems.find((item) => item.name === 'Chosen Arcanespark')
    if (
      factionPlannerItems.length < 450 ||
      factionPlannerItems.some((item) => item.rarity !== 'faction') ||
      !chosenArcanespark?.acquisition?.factions?.some(
        (requirement) =>
          requirement.faction === "Kymon's Chosen" && requirement.reputation === 'Respected'
      )
    ) {
      throw new Error('Faction planning catalog did not preserve reputation vendor requirements.')
    }
    const monsterInfrequents = helperSnapshot.items.filter((item) => item.rarity === 'mi')
    const frostsnarlTiers = monsterInfrequents.filter((item) => item.name === "Frostsnarl's Horns")
    const skillRareTiers = new Map(
      ['Weaver Ring', 'Devourer Ring', 'Ascended Shoulderplates'].map((name) => [
        name,
        monsterInfrequents.filter((item) => item.name === name)
      ])
    )
    const unresolvedMiSources = monsterInfrequents.filter(
      (item) => !item.acquisition?.sources.some((source) => source.startsWith('Dropped by '))
    )
    if (
      monsterInfrequents.length < 1_600 ||
      unresolvedMiSources.length > 20 ||
      frostsnarlTiers.length !== 6 ||
      frostsnarlTiers.some(
        (item) => item.acquisition?.sources[0] !== 'Dropped by Frostsnarl the Chosen'
      )
    ) {
      throw new Error('Monster Infrequent source traversal did not resolve every live MI tier.')
    }
    if (
      skillRareTiers.get('Weaver Ring')?.length !== 7 ||
      skillRareTiers.get('Devourer Ring')?.length !== 6 ||
      skillRareTiers.get('Ascended Shoulderplates')?.length !== 6 ||
      [...skillRareTiers.values()].flat().some(
        (item) => !item.acquisition?.sources.some((source) => source.startsWith('Dropped by '))
      )
    ) {
      throw new Error('Build-defining green skill bases were not catalogued with their source tiers.')
    }
    const ignusShoulders = helperSnapshot.items.find((item) => item.name === "Ignus' Shoulderguards")
    const bloodswornSignet = helperSnapshot.items.find((item) => item.name === 'Bloodsworn Signet')
    const kravallShoulders = helperSnapshot.items.find((item) => item.name === "Kra'vall Shoulderguards")
    const loghorreanShoulders = helperSnapshot.items.find((item) => item.name === "Loghorrean's Corruption")
    if (
      !ignusShoulders?.acquisition?.sources.every((source) => source.startsWith('Dropped by ')) ||
      !bloodswornSignet?.acquisition?.sources.every((source) => source.startsWith('Dropped by ')) ||
      !kravallShoulders?.acquisition?.sources.some((source) => source.startsWith('Found in ')) ||
      !loghorreanShoulders?.acquisition?.sources.some((source) => source.startsWith('Found in '))
    ) {
      throw new Error('MI acquisition indexing did not separate monster drops from chest-only bases.')
    }
    const deterministicRecipes = helperSnapshot.items.filter((item) => item.acquisition?.crafting)
    const abyssalMask = deterministicRecipes.find((item) => item.name === 'Abyssal Mask')
    const mistbornTalisman = deterministicRecipes.find((item) => item.name === 'Mistborn Talisman')
    const randomLegendary = helperSnapshot.items.find((item) => item.name === 'Demonbone Legplates')
    if (
      deterministicRecipes.length < 400 ||
      !abyssalMask?.acquisition?.crafting?.knownSoftcore ||
      mistbornTalisman?.rarity !== 'rare' ||
      !mistbornTalisman.acquisition?.crafting?.blueprintRecords.some((record) =>
        record.endsWith('/craft_relic_b011.dbr')
      ) ||
      randomLegendary?.acquisition?.crafting
    ) {
      throw new Error('Known-blueprint indexing did not distinguish direct recipes from random crafting tables.')
    }
    const mapIndex = await helper.request<MapLocationIndex>('build-map-location-index', {
      installationPath: helperSnapshot.discovery.installations[0]?.path
    })
    const frostsnarlLocations =
      mapIndex.sourceLocations[
        'records/creatures/enemies/boss&quest/dranghoul_frostsnarl_01.dbr'
      ] ?? []
    if (!frostsnarlLocations.some((location) => location.name.includes("Kruu'Sul Crags"))) {
      throw new Error('Map location index did not place Frostsnarl in Kruu\'Sul Crags.')
    }
    const campaignLocationExamples = [
      'records/creatures/enemies/nemesis/nemesis_kymon_01.dbr',
      'records/creatures/enemies/nemesis/nemesis_orderdeathsvigil_02.dbr',
      'records/creatures/enemies/boss&quest/cultist_chthonianmonstrosity.dbr'
    ]
    if (campaignLocationExamples.some((record) =>
      !(mapIndex.sourceLocations[record] ?? []).some((location) => location.zoneRecord)
    )) {
      throw new Error('Map location index did not resolve scripted nemesis and summoned-boss campaign sources.')
    }
    const shatteredRealmLocations = Object.values(mapIndex.sourceLocations)
      .flat()
      .filter((location) => location.levelFile.includes('/EndlessDungeon/'))
    if (
      mapIndex.miTierCount - mapIndex.locatedMiTierCount > 128 ||
      shatteredRealmLocations.length > 0
    ) {
      throw new Error('Map location index retained Shattered Realm proxies or lost too many campaign item tiers.')
    }
    const flamebrand = helperSnapshot.items.find((item) => item.name === 'Flamebrand')
    const flamebrandFire = flamebrand?.presentation?.sections
      .flatMap((section) => section.lines)
      .find((line) => line.label === 'Fire Damage')
    if (
      !flamebrand?.presentation?.searchText.includes('Fire Strike') ||
      flamebrandFire?.minimum !== 40 ||
      flamebrandFire.maximum !== 60
    ) {
      throw new Error('Catalog presentation did not preserve Flamebrand skill text and roll ranges.')
    }
    const mythicalMaw = helperSnapshot.items.find(
      (item) => item.name === 'Mythical Maw of the Damned'
    )
    const mawGrantedLines = mythicalMaw?.presentation?.grantedSkill?.lines ?? []
    if (
      mawGrantedLines.find((line) => line.label === 'Energy Cost')?.minimum !== 60 ||
      mawGrantedLines.find((line) => line.label === 'Bleeding Damage over 3 Seconds')?.minimum !== 1320 ||
      mythicalMaw?.presentation?.sections.filter((section) => section.kind === 'skill-modifier').length !== 3
    ) {
      throw new Error('Catalog presentation did not resolve Mythical Maw skill levels and modifiers.')
    }
    const jackalStep = helperSnapshot.items.find((item) => item.name === "Mythical Jackal's Step")
    const stunBlast = helperSnapshot.items
      .flatMap((item) => item.setPresentation?.tiers ?? [])
      .map((tier) => tier.grantedSkill)
      .find((skill) => skill?.name === 'Stun Blast')
    if (
      jackalStep?.presentation?.grantedSkill?.trigger !== '20% Chance when Hit' ||
      stunBlast?.trigger !== '35% Chance on Default Weapon Attack'
    ) {
      throw new Error('Granted passive and proc skills did not preserve their activation trigger.')
    }
    const forbiddenMark = helperSnapshot.items.find(
      (item) => item.name === 'Mythical Mark of the Forbidden'
    )
    const wendigoModifier = forbiddenMark?.presentation?.sections.find(
      (section) => section.kind === 'skill-modifier' && section.heading === 'Wendigo Totem'
    )
    const anySkillConversion = helperSnapshot.items
      .flatMap((item) => item.presentation?.sections ?? [])
      .filter((section) => section.kind === 'skill-modifier')
      .flatMap((section) => section.lines)
      .some((line) => line.label.includes('Damage converted to'))
    if (
      wendigoModifier?.lines.find((line) => line.label === 'Vitality Damage')?.minimum !== 100 ||
      !anySkillConversion
    ) {
      throw new Error('Pet skill modifiers did not preserve special damage or conversion payloads.')
    }
    const oathbreaker = helperSnapshot.items.find((item) => item.setName === 'Oathbreaker')
      ?.setPresentation
    const marauder = helperSnapshot.items.find((item) => item.setName === "Marauder's Justice")
      ?.setPresentation
    const brimstone = helperSnapshot.items.find((item) => item.setName === 'Brimstone')
      ?.setPresentation
    const lightsGuardian = helperSnapshot.items.find((item) => item.setName === "Light's Guardian")
      ?.setPresentation
    const lightningNova = lightsGuardian?.tiers
      .flatMap((tier) => tier.grantedSkill?.linkedSkills ?? [])
      .find((skill) => skill.name === 'Lightning Nova')
    const lightningNovaDamage = lightningNova?.lines.find((line) => line.label === 'Lightning Damage')
    const lightningNovaElectrocute = lightningNova?.lines.find(
      (line) => line.label === 'Electrocute Damage over 2 Seconds'
    )
    if (
      !oathbreaker?.tiers.some(
        (tier) => tier.lines.some((line) => line.tone === 'skill' && line.minimum === 3) &&
          tier.grantedSkill
      ) ||
      !marauder?.tiers.some(
        (tier) =>
          tier.requiredPieces === 3 &&
          tier.lines.some((line) => line.label === 'Fire Damage' && line.minimum === 7) &&
          tier.lines.some((line) => line.label === 'Cold Damage' && line.minimum === 7)
      ) ||
      !brimstone?.tiers.some(
        (tier) =>
          tier.requiredPieces === 2 &&
          tier.lines.some((line) => line.label === 'Fire Damage' && line.minimum === 18)
      ) ||
      lightningNovaDamage?.minimum !== 320 ||
      lightningNovaDamage.maximum !== 500 ||
      lightningNovaElectrocute?.minimum !== 600
    ) {
      throw new Error('Set presentation omitted or misleveled flat damage, skill bonuses, or granted skills.')
    }
    const iceKing = helperSnapshot.items.find((item) => item.setName === "Ice King's Adornments")
      ?.setPresentation
    const iceKingModifiers = iceKing?.tiers.flatMap((tier) => tier.skillModifiers) ?? []
    const iceKingHellhound = iceKingModifiers.find(
      (section) => section.kind === 'skill-modifier' && section.heading === 'Summon Hellhound'
    )
    const iceKingVisual = iceKingModifiers.find(
      (section) => section.kind === 'visual-modifier' &&
        section.lines.some((line) => line.label === 'Summoned form: Direwolf')
    )
    const anyWpsSetModifier = helperSnapshot.items
      .flatMap((item) => item.setPresentation?.tiers ?? [])
      .flatMap((tier) => tier.skillModifiers)
      .filter((section) => section.kind === 'skill-modifier')
      .some((section) =>
        section.lines.some((line) => line.label === 'Weapon Damage') &&
        section.lines.some((line) => line.label === 'Chance on Default Weapon Attack')
      )
    const anyProjectileVisual = helperSnapshot.items
      .flatMap((item) => item.setPresentation?.tiers ?? [])
      .flatMap((tier) => tier.skillModifiers)
      .filter((section) => section.kind === 'visual-modifier')
      .some((section) =>
        section.lines.some((line) => line.label === 'Alternate projectile effects')
      )
    if (
      iceKingHellhound?.lines.find(
        (line) => line.label === 'Chaos Damage converted to Cold Damage'
      )?.minimum !== 100 ||
      !iceKingVisual ||
      !anyWpsSetModifier ||
      !anyProjectileVisual
    ) {
      throw new Error('Set presentation omitted a mechanical or visual skill modifier.')
    }
    const invertedRange = helperSnapshot.items
      .flatMap((item) => item.presentation?.sections ?? [])
      .flatMap((section) => section.lines)
      .find(
        (line) =>
          line.minimum !== null && line.maximum !== null && line.minimum > line.maximum
      )
    if (invertedRange) {
      throw new Error(`Catalog presentation produced an inverted range for ${invertedRange.label}.`)
    }
    const analyzedCopies = helperSnapshot.observedItems.filter(
      (item) => item.rollAnalysis !== null
    )
    const trustedRolls = analyzedCopies.filter(
      (item) =>
        item.rollAnalysis?.trusted === true &&
        item.rollAnalysis.overallEstimatedPercentile !== null &&
        item.rollAnalysis.percentileSampleSize === 4096
    )
    if (analyzedCopies.length === 0 || trustedRolls.length === 0) {
      throw new Error('Collection scan did not produce any trusted roll analyses.')
    }
    for (const item of helperSnapshot.items.filter((candidate) => candidate.bestRollPercentile !== null)) {
      const expected = Math.max(
        ...trustedRolls
          .filter((copy) => copy.baseRecord.toLowerCase() === item.record.toLowerCase())
          .map((copy) => copy.rollAnalysis!.overallEstimatedPercentile!)
      )
      if (Math.abs(expected - item.bestRollPercentile!) > 0.0000001) {
        throw new Error('Catalog best-roll selection does not match its trusted copies: ' + item.record)
      }
    }
    const roundTrips = await Promise.all(
      helperSnapshot.scannedStashes.map((stash) =>
        helper.request<{ semanticallyEquivalent: boolean; idempotent: boolean }>(
          'validate-transfer-stash-roundtrip',
          { path: stash.path }
        )
      )
    )
    if (roundTrips.some((result) => !result.semanticallyEquivalent || !result.idempotent)) {
      throw new Error('A transfer stash failed serializer round-trip validation.')
    }
    const ingestPlans = await Promise.all(
      helperSnapshot.scannedStashes
        .filter((stash) => stash.itemCount > 0)
        .map((stash) => {
          const observed = helperSnapshot.observedItems.find(
            (item) => item.sourcePath.toLowerCase() === stash.path.toLowerCase()
          )
          if (!observed) {
            throw new Error('Non-empty stash has no observed item: ' + stash.path)
          }
          return helper.request<{
            sourceItemCount: number
            replacementItemCount: number
            semanticallyValid: boolean
            idempotent: boolean
            items: Array<{ baseRecord: string; [key: string]: unknown }>
          }>('validate-ingest-plan', {
            path: stash.path,
            tabIndex: observed.tabIndex,
            itemIndex: observed.itemIndex
          })
        })
    )
    if (
      ingestPlans.some(
        (plan) =>
          !plan.semanticallyValid ||
          !plan.idempotent ||
          plan.replacementItemCount !== plan.sourceItemCount - 1
      )
    ) {
      throw new Error('A transfer stash failed the in-memory ingest plan validation.')
    }
    const retrievalRoundTrips = await Promise.all(
      helperSnapshot.scannedStashes
        .filter((stash) => stash.itemCount > 0)
        .map((stash) => {
          const observed = helperSnapshot.observedItems.find(
            (item) => item.sourcePath.toLowerCase() === stash.path.toLowerCase()
          )
          if (!observed) {
            throw new Error('Non-empty stash has no observed item: ' + stash.path)
          }
          return helper.request<{
            sourceItemCount: number
            restoredItemCount: number
            semanticallyEquivalent: boolean
            idempotent: boolean
          }>('validate-ingest-retrieval-roundtrip', {
            path: stash.path,
            tabIndex: observed.tabIndex,
            itemIndex: observed.itemIndex
          })
        })
    )
    if (
      retrievalRoundTrips.some(
        (result) =>
          !result.semanticallyEquivalent ||
          !result.idempotent ||
          result.restoredItemCount !== result.sourceItemCount
      )
    ) {
      throw new Error('A transfer stash failed the in-memory ingest/retrieval roundtrip.')
    }
    const snapshot = database.persistSnapshot(helperSnapshot)
    if (snapshot.supplySummary?.total !== supplies.length) {
      throw new Error('Reusable supply completion was not projected into the collection snapshot.')
    }
    const recipeArchiveSnapshot = withRecipeCollection(
      database.presentArchiveSnapshot(snapshot, [], false),
      false
    )
    const recipeUnlockedMask = recipeArchiveSnapshot.items.find(
      (item) => item.name === 'Abyssal Mask'
    )
    if (
      recipeArchiveSnapshot.recipeSummary.total < 400 ||
      recipeArchiveSnapshot.recipeSummary.collected === 0 ||
      !recipeUnlockedMask?.recipeUnlocked ||
      recipeUnlockedMask.discovered ||
      recipeUnlockedMask.availableCount !== 0
    ) {
      throw new Error('Known recipes did not stay explicit and separate from discovered copies.')
    }
    const awakenedCatalogItem = helperSnapshot.items.find((item) => item.baseVersionRecord)
    const awakeningBase = awakenedCatalogItem?.baseVersionRecord
      ? helperSnapshot.items.find(
          (item) => item.record.toLowerCase() === awakenedCatalogItem.baseVersionRecord!.toLowerCase()
        )
      : undefined
    if (!awakenedCatalogItem || !awakeningBase) {
      throw new Error('Catalog did not link an Awakened Legendary to its Epic base.')
    }
    const [availableAwakened] = withAwakeningAvailability(
      [{ ...awakenedCatalogItem, availableCount: 0, discovered: false }],
      [{ ...awakeningBase, availableCount: 1, discovered: true }]
    )
    if (
      !availableAwakened ||
      !isCollectionOwned(availableAwakened) ||
      !availableAwakened.availableViaAwakening ||
      availableAwakened.availableCount !== 0 ||
      availableAwakened.awakeningSourceRecord?.toLowerCase() !== awakeningBase.record.toLowerCase()
    ) {
      throw new Error('Owned Epic bases did not qualify their Awakened Legendary without fabricating a stored copy.')
    }
    const pinCandidate = snapshot.observedItems.find(
      (item) => item.instanceKey && item.rollAnalysis?.trusted
    )
    if (!pinCandidate?.instanceKey) {
      throw new Error('Smoke test needs one trusted copy to verify pinned-best persistence.')
    }
    database.setPinnedBest(pinCandidate.baseRecord, pinCandidate.instanceKey)
    const pinnedSnapshot = database.persistSnapshot({
      ...helperSnapshot,
      scannedAtUtc: new Date(Date.parse(helperSnapshot.scannedAtUtc) + 0.5).toISOString()
    })
    const pinnedCatalogItem = pinnedSnapshot.items.find(
      (item) => item.record.toLowerCase() === pinCandidate.baseRecord.toLowerCase()
    )
    if (pinnedCatalogItem?.pinnedInstanceKey !== pinCandidate.instanceKey) {
      throw new Error('Pinned-best selection did not survive a subsequent collection snapshot.')
    }
    database.setPinnedBest(pinCandidate.baseRecord, null)
    const journalPayload = ingestPlans[0]?.items[0]
    if (!journalPayload) {
      throw new Error('Smoke test needs one item payload to verify retrieval journal transitions.')
    }
    const journalVaultItemId = randomUUID()
    const ingestOperationId = randomUUID()
    database.prepareIngestOperation({
      operationId: ingestOperationId,
      stashPath: 'smoke-test-transfer.gsh',
      sourceSha256: 'smoke-source',
      startedAtUtc: new Date().toISOString(),
      items: [
        {
          vaultItemId: journalVaultItemId,
          baseRecord: journalPayload.baseRecord,
          payload: journalPayload
        }
      ],
      detail: { phase: 'prepared', smokeTest: true }
    })
    database.completeIngestOperation({
      operationId: ingestOperationId,
      backupPath: 'smoke-ingest-backup',
      completedAtUtc: new Date().toISOString(),
      isHardcore: true,
      detail: { phase: 'committed', smokeTest: true }
    })
    const archivedSmokeCopy = helperSnapshot.observedItems.find(
      (item) =>
        item.baseRecord.toLowerCase() === journalPayload.baseRecord.toLowerCase() &&
        item.seed === journalPayload.seed
    )
    const archivedBeforeRetrieval = database
      .presentArchiveSnapshot(snapshot, archivedSmokeCopy ? [archivedSmokeCopy] : [], true)
      .items.find((item) => item.record.toLowerCase() === journalPayload.baseRecord.toLowerCase())
    if (
      !archivedBeforeRetrieval?.discovered ||
      archivedBeforeRetrieval.availableCount !== 1
    ) {
      throw new Error('Codex Archive did not own the newly ingested item.')
    }
    const retrievalOperationId = randomUUID()
    database.prepareRetrievalOperation({
      operationId: retrievalOperationId,
      stashPath: 'smoke-test-transfer.gsh',
      sourceSha256: 'smoke-retrieval-source',
      startedAtUtc: new Date().toISOString(),
      vaultItemIds: [journalVaultItemId],
      detail: { phase: 'prepared', smokeTest: true }
    })
    if (database.getVaultItems([journalVaultItemId])[0]?.state !== 'retrieval_pending') {
      throw new Error('Vault item did not enter retrieval_pending state.')
    }
    database.completeRetrievalOperation({
      operationId: retrievalOperationId,
      backupPath: 'smoke-retrieval-backup',
      completedAtUtc: new Date().toISOString(),
      vaultItemIds: [journalVaultItemId],
      detail: { phase: 'committed', smokeTest: true }
    })
    const archivedAfterRetrieval = database
      .presentArchiveSnapshot(snapshot, [], true)
      .items.find((item) => item.record.toLowerCase() === journalPayload.baseRecord.toLowerCase())
    if (!archivedAfterRetrieval?.discovered || archivedAfterRetrieval.availableCount !== 0) {
      throw new Error('Codex Archive did not retain collection history after retrieval.')
    }
    if (database.getVaultItems([journalVaultItemId])[0]?.state !== 'retrieved') {
      throw new Error('Vault item did not enter retrieved state.')
    }
    const listedVaultItem = database.listVaultItems().find((item) => item.id === journalVaultItemId)
    if (
      !listedVaultItem ||
      listedVaultItem.state !== 'retrieved' ||
      listedVaultItem.seed !== (journalPayload.seed as number)
    ) {
      throw new Error('Vault listing did not project the stored payload and lifecycle state.')
    }
    const reusableVaultItemId = randomUUID()
    const reusableIngestOperationId = randomUUID()
    database.prepareIngestOperation({
      operationId: reusableIngestOperationId,
      stashPath: 'smoke-test-transfer.gsh',
      sourceSha256: 'smoke-reusable-source',
      startedAtUtc: new Date().toISOString(),
      items: [
        {
          vaultItemId: reusableVaultItemId,
          baseRecord: warrant.record,
          payload: { baseRecord: warrant.record, seed: 42, stackCount: 99 }
        }
      ],
      detail: { phase: 'prepared', smokeTest: true, reusable: true }
    })
    database.completeIngestOperation({
      operationId: reusableIngestOperationId,
      backupPath: 'smoke-reusable-ingest-backup',
      completedAtUtc: new Date().toISOString(),
      isHardcore: true,
      detail: { phase: 'committed', smokeTest: true, reusable: true }
    })
    const reusableBeforeRetrieval = database.getVaultItems([reusableVaultItemId])[0]
    if (
      !reusableBeforeRetrieval?.reusable ||
      reusableBeforeRetrieval.state !== 'ingested' ||
      (reusableBeforeRetrieval.payload as { stackCount?: number }).stackCount !== 1
    ) {
      throw new Error('Reusable supply ingest did not retain one normalized dispensable template.')
    }
    const reusableRetrievalOperationId = randomUUID()
    database.prepareRetrievalOperation({
      operationId: reusableRetrievalOperationId,
      stashPath: 'smoke-test-transfer.gsh',
      sourceSha256: 'smoke-reusable-retrieval-source',
      startedAtUtc: new Date().toISOString(),
      vaultItemIds: [reusableVaultItemId],
      detail: { phase: 'prepared', smokeTest: true, reusable: true }
    })
    database.completeRetrievalOperation({
      operationId: reusableRetrievalOperationId,
      backupPath: 'smoke-reusable-retrieval-backup',
      completedAtUtc: new Date().toISOString(),
      vaultItemIds: [reusableVaultItemId],
      detail: { phase: 'committed', smokeTest: true, reusable: true }
    })
    const reusableAfterRetrieval = database.getVaultItems([reusableVaultItemId])[0]
    const listedReusable = database.listVaultItems().find((item) => item.id === reusableVaultItemId)
    if (
      reusableAfterRetrieval?.state !== 'ingested' ||
      !reusableAfterRetrieval.reusable ||
      listedReusable?.state !== 'ingested' ||
      !listedReusable.reusable ||
      listedReusable.slot !== 'warrant'
    ) {
      throw new Error('Dispensing a reusable supply consumed its stored unlock.')
    }
    const ingestedPage = database.queryVaultItems({
      state: 'ingested',
      isHardcore: true,
      sort: 'recent',
      direction: 'desc',
      offset: 0,
      limit: 1
    })
    const retrievedPage = database.queryVaultItems({
      state: 'retrieved',
      sort: 'name',
      direction: 'asc',
      offset: 0,
      limit: 1
    })
    const searchedPage = database.queryVaultItems({
      state: 'ingested',
      query: listedReusable.name,
      sort: 'level',
      direction: 'desc',
      offset: 0,
      limit: 100
    })
    const escapedSearchPage = database.queryVaultItems({
      state: 'ingested',
      query: '%_',
      sort: 'roll',
      direction: 'desc',
      offset: 0,
      limit: 100
    })
    const structuredSearchPage = database.queryVaultItems({
      state: 'ingested',
      query: `base:"${warrant.record}" AND seed:42 AND mode:hardcore`,
      sort: 'level',
      direction: 'desc',
      offset: 0,
      limit: 100
    })
    const negatedSearchPage = database.queryVaultItems({
      state: 'ingested',
      query: `base:"${warrant.record}" AND NOT seed:42`,
      sort: 'recent',
      direction: 'desc',
      offset: 0,
      limit: 100
    })
    const ingestionHistory = database.queryOperationHistory({
      operation: 'ingest',
      outcome: 'committed',
      query: journalPayload.baseRecord,
      offset: 0,
      limit: 100
    })
    const retrievalHistory = database.queryOperationHistory({
      operation: 'retrieve',
      outcome: 'all',
      query: retrievalOperationId,
      offset: 0,
      limit: 100
    })
    const structuredHistory = database.queryOperationHistory({
      operation: 'ingest',
      outcome: 'all',
      query: `id:${ingestOperationId} AND mode:hardcore AND seed:${journalPayload.seed}`,
      offset: 0,
      limit: 100
    })
    let invalidStructuredSearchRejected = false
    try {
      database.queryVaultItems({
        state: 'ingested', query: 'level:ancient', sort: 'recent', direction: 'desc', offset: 0, limit: 100
      })
    } catch (error) {
      invalidStructuredSearchRejected = error instanceof Error && error.message.includes('needs a number')
    }
    const journalIngest = ingestionHistory.items.find((entry) => entry.id === ingestOperationId)
    const journalRetrieval = retrievalHistory.items.find((entry) => entry.id === retrievalOperationId)
    const vaultSummary = database.getVaultSummary()
    if (!structuredSearchPage.items.some((item) => item.id === reusableVaultItemId)) {
      throw new Error(`Structured vault search missed its fixture (${structuredSearchPage.total} matches).`)
    }
    if (negatedSearchPage.items.some((item) => item.id === reusableVaultItemId)) {
      throw new Error('Negated structured vault search retained the excluded fixture.')
    }
    if (structuredHistory.items[0]?.id !== ingestOperationId) {
      throw new Error(`Structured operation search missed its fixture (${structuredHistory.total} matches).`)
    }
    if (!invalidStructuredSearchRejected) {
      throw new Error('Invalid numeric structured search did not return an actionable error.')
    }
    if (
      ingestedPage.total < 1 ||
      ingestedPage.items.length !== 1 ||
      retrievedPage.total < 1 ||
      retrievedPage.items.length !== 1 ||
      !searchedPage.items.some((item) => item.id === reusableVaultItemId) ||
      escapedSearchPage.total !== 0 ||
      journalIngest?.isHardcore !== true ||
      journalIngest.itemCount !== 1 ||
      journalIngest.items[0]?.seed !== journalPayload.seed ||
      journalRetrieval?.state !== 'committed' ||
      journalRetrieval.itemCount !== 1 ||
      vaultSummary.total < 2 ||
      vaultSummary.ingested < 1 ||
      vaultSummary.retrieved < 1
    ) {
      throw new Error('Paged vault querying did not preserve filtering, sorting, or summary counts.')
    }
    const clarityVaultItemId = randomUUID()
    const clarityIngestOperationId = randomUUID()
    database.prepareIngestOperation({
      operationId: clarityIngestOperationId,
      stashPath: 'smoke-test-transfer.gsh',
      sourceSha256: 'smoke-clarity-source',
      startedAtUtc: new Date().toISOString(),
      items: [
        {
          vaultItemId: clarityVaultItemId,
          baseRecord: clarityPotion.record,
          payload: { baseRecord: clarityPotion.record, seed: 43, stackCount: 20 }
        }
      ],
      detail: { phase: 'prepared', smokeTest: true, finiteStack: true }
    })
    database.completeIngestOperation({
      operationId: clarityIngestOperationId,
      backupPath: 'smoke-clarity-ingest-backup',
      completedAtUtc: new Date().toISOString(),
      isHardcore: true,
      detail: { phase: 'committed', smokeTest: true, finiteStack: true }
    })
    const storedClarity = database.getVaultItems([clarityVaultItemId])[0]
    if (
      storedClarity?.state !== 'ingested' ||
      storedClarity.reusable ||
      (storedClarity.payload as { stackCount?: number }).stackCount !== 20
    ) {
      throw new Error('Potion of Clarity did not preserve its finite stack count in Supplies.')
    }
    if (!database.getInfiniteSupplies() || database.setInfiniteSupplies(false) !== false) {
      throw new Error('Infinite-supplies setting did not persist its disabled state.')
    }
    if (
      database.getDebugLogging() ||
      database.setDebugLogging(true) !== true ||
      !database.getDebugLogging() ||
      database.setDebugLogging(false) !== false ||
      database.getDebugLogging()
    ) {
      throw new Error('Debug-logging setting did not round-trip safely.')
    }
    const finiteRetrievalOperationId = randomUUID()
    database.prepareRetrievalOperation({
      operationId: finiteRetrievalOperationId,
      stashPath: 'smoke-test-transfer.gsh',
      sourceSha256: 'smoke-finite-supply-source',
      startedAtUtc: new Date().toISOString(),
      vaultItemIds: [reusableVaultItemId],
      detail: { phase: 'prepared', smokeTest: true, reusable: false }
    })
    database.completeRetrievalOperation({
      operationId: finiteRetrievalOperationId,
      backupPath: 'smoke-finite-supply-backup',
      completedAtUtc: new Date().toISOString(),
      vaultItemIds: [reusableVaultItemId],
      detail: { phase: 'committed', smokeTest: true, reusable: false }
    })
    database.setInfiniteSupplies(true)
    const finiteAfterRetrieval = database.getVaultItems([reusableVaultItemId])[0]
    const clarityAfterSettingToggle = database.getVaultItems([clarityVaultItemId])[0]
    if (
      finiteAfterRetrieval?.state !== 'retrieved' ||
      finiteAfterRetrieval.reusable ||
      clarityAfterSettingToggle?.reusable ||
      (clarityAfterSettingToggle?.payload as { stackCount?: number } | undefined)?.stackCount !== 20 ||
      !database.getInfiniteSupplies()
    ) {
      throw new Error('Disabling infinite supplies did not consume the dispensed stored copy.')
    }
    const migrationInput = {
      sourcePath: 'smoke-gdia-userdata.db',
      sourceSha256: 'smoke-gdia-source',
      backupPath: 'smoke-gdia-backup',
      importedAtUtc: new Date().toISOString(),
      items: [1, 2].map((externalId) => ({
        externalId: String(externalId),
        baseRecord: journalPayload.baseRecord as string,
        isHardcore: true,
        createdAtUtc: new Date().toISOString(),
        payload: journalPayload
      }))
    }
    const migration = database.importVaultItems(migrationInput)
    const repeatedMigration = database.importVaultItems(migrationInput)
    if (
      migration.importedIds.length !== 2 ||
      migration.duplicateIds.length !== 0 ||
      repeatedMigration.importedIds.length !== 0 ||
      repeatedMigration.duplicateIds.length !== 2
    ) {
      throw new Error('GDIA migration did not preserve copy multiplicity or idempotency.')
    }
    let duplicateSelectionRejected = false
    try {
      database.getVaultItems([migration.importedIds[0]!, migration.importedIds[0]!], true)
    } catch (error) {
      duplicateSelectionRejected =
        error instanceof Error && error.message.includes('Duplicate vault item IDs')
    }
    if (!duplicateSelectionRejected) {
      throw new Error('Vault retrieval accepted the same copy ID more than once.')
    }
    const failedRetrievalId = randomUUID()
    database.prepareRetrievalOperation({
      operationId: failedRetrievalId,
      stashPath: 'smoke-full-target.gsh',
      sourceSha256: 'smoke-full-target',
      startedAtUtc: new Date().toISOString(),
      vaultItemIds: [migration.importedIds[0]!],
      detail: { phase: 'prepared', smokeTest: true, scenario: 'full_target' }
    })
    database.failRetrievalOperation(
      failedRetrievalId,
      [migration.importedIds[0]!],
      new Error('Target tab is full.')
    )
    if (database.getVaultItems([migration.importedIds[0]!], true)[0]?.state !== 'ingested') {
      throw new Error('A rejected retrieval did not return its copy to ingested state.')
    }
    const committedDeliveryId = randomUUID()
    database.prepareDeliveryOperation({
      operationId: committedDeliveryId,
      destination: 'live://smoke/personal-inventory',
      payloadSha256: 'smoke-delivery-payload',
      startedAtUtc: new Date().toISOString(),
      detail: { phase: 'prepared', smokeTest: true, transferKind: 'generated_delivery' }
    })
    database.updatePendingOperationDetail(committedDeliveryId, {
      phase: 'queued',
      queues: [{ operationId: `${committedDeliveryId}-0`, semanticSha256: 'smoke-semantic-hash' }]
    })
    database.completeDeliveryOperation({
      operationId: committedDeliveryId,
      receiptPath: 'smoke-delivery-receipt',
      completedAtUtc: new Date().toISOString(),
      detail: { phase: 'committed', smokeTest: true, transferKind: 'generated_delivery' }
    })
    const rejectedDeliveryId = randomUUID()
    database.prepareDeliveryOperation({
      operationId: rejectedDeliveryId,
      destination: 'live://smoke/personal-inventory',
      payloadSha256: 'smoke-rejected-delivery-payload',
      startedAtUtc: new Date().toISOString(),
      detail: { phase: 'prepared', smokeTest: true, transferKind: 'generated_delivery' }
    })
    database.failDeliveryOperation(rejectedDeliveryId, new Error('Target inventory is full.'))
    const deliveryJournal = database.getDiagnosticSummary().journalStates
    if (
      !deliveryJournal.some(
        (entry) => entry.operation === 'retrieve' && entry.state === 'committed' && entry.count >= 2
      ) ||
      !deliveryJournal.some(
        (entry) => entry.operation === 'retrieve' && entry.state === 'failed' && entry.count >= 2
      )
    ) {
      throw new Error('Generated live deliveries did not retain committed and rejected journal outcomes.')
    }
    const rollCacheCandidate = database
      .listAvailableArchiveItems(true)
      .find((item) => item.id === migration.importedIds[0])
    const sourceRoll = archivedSmokeCopy?.rollAnalysis
    if (!rollCacheCandidate || !sourceRoll) {
      throw new Error('Smoke test needs an archived analyzed copy to verify roll caching.')
    }
    const pendingRollsBefore = database.countArchiveRollAnalysisCandidates(
      ROLL_ANALYSIS_VERSION,
      true
    )
    if (
      !database
        .listArchiveRollAnalysisCandidates(ROLL_ANALYSIS_VERSION, 1_000, true)
        .some((item) => item.id === rollCacheCandidate.id)
    ) {
      throw new Error('Missing archive roll analysis was not selected for bounded hydration.')
    }
    database.setVaultRollAnalyses([{ id: rollCacheCandidate.id, rollAnalysis: sourceRoll }])
    if (
      database.listAvailableArchiveItems(true).find((item) => item.id === rollCacheCandidate.id)
        ?.rollAnalysis?.overallEstimatedPercentile !== sourceRoll.overallEstimatedPercentile
    ) {
      throw new Error('Archive roll analysis did not survive a database round trip.')
    }
    if (
      database.countArchiveRollAnalysisCandidates(ROLL_ANALYSIS_VERSION, true) !==
        pendingRollsBefore - 1 ||
      database
        .listArchiveRollAnalysisCandidates(ROLL_ANALYSIS_VERSION, 1_000, true)
        .some((item) => item.id === rollCacheCandidate.id) ||
      !database
        .listArchiveRollAnalysisCandidates(ROLL_ANALYSIS_VERSION + 1, 1_000, true)
        .some((item) => item.id === rollCacheCandidate.id)
    ) {
      throw new Error('Bounded archive roll hydration did not respect cached model versions.')
    }
    const discovery = snapshot.discovery
    const stashCount = discovery.saveLocations.reduce(
      (count, location) => count + location.transferStashes.length,
      0
    )
    const collected = snapshot.rarities.reduce((count, rarity) => count + rarity.collected, 0)
    const unavailableSnapshot = database.persistSnapshot({
      ...helperSnapshot,
      scannedAtUtc: new Date(Date.parse(helperSnapshot.scannedAtUtc) + 1).toISOString(),
      scannedStashes: [],
      observedItems: [],
      items: helperSnapshot.items.map((item) => ({ ...item, availableCount: 0 }))
    })
    const retainedDiscoveries = unavailableSnapshot.rarities.reduce(
      (count, rarity) => count + rarity.collected,
      0
    )
    if (retainedDiscoveries !== collected) {
      throw new Error('Lifetime discoveries were lost when availability dropped to zero.')
    }
    const recoverySmokeRoot = join(
      app.getPath('temp'),
      `cairn-codex-live-recovery-smoke-${randomUUID()}`
    )
    const recoverySmokePath = join(recoverySmokeRoot, 'archive.sqlite3')
    let recoveryDatabase: CollectionDatabase | null = null
    try {
      await mkdir(recoverySmokeRoot, { recursive: true })
      recoveryDatabase = new CollectionDatabase(recoverySmokePath)
      recoveryDatabase.persistSnapshot(helperSnapshot)
      const recoveryImport = recoveryDatabase.importVaultItems({
        sourcePath: 'smoke-recovery-source',
        sourceSha256: 'smoke-recovery-source-hash',
        backupPath: 'smoke-recovery-backup',
        importedAtUtc: new Date().toISOString(),
        items: [0, 1, 2].map((externalId) => ({
          externalId: `recovery-${externalId}`,
          baseRecord: journalPayload.baseRecord as string,
          isHardcore: true,
          createdAtUtc: new Date().toISOString(),
          payload: journalPayload
        }))
      })
      const queue = (operationId: string, hashCharacter: string): LiveRetrievalQueue => ({
        operationId,
        outgoingPath: join(recoverySmokeRoot, 'queue', `${operationId}.csv`),
        semanticSha256: hashCharacter.repeat(64),
        isHardcore: true,
        baselineDeleted: [],
        baselineIncoming: []
      })
      const incomingItems: LiveIncomingItem[] = [0, 1].map((index) => ({
        path: join(recoverySmokeRoot, 'incoming', `smoke-ingest-${index}.csv`),
        sha256: String(index + 1).repeat(64),
        isHardcore: true,
        item: { ...(journalPayload as unknown as LiveVaultPayload), seed: 1000 + index },
        createdAtUtc: new Date().toISOString()
      }))
      const incomingHelper: HelperRequester = {
        request: async <T>(method: string, params: object = {}): Promise<T> => {
          if (method === 'inspect-live-game') {
            return { state: 'unavailable', detail: 'Offline recovery smoke.' } as T
          }
          if (method === 'poll-live-incoming') return incomingItems as T
          if (method === 'copy-live-incoming' || method === 'ack-live-incoming') {
            const input = params as { path: string; expectedSha256: string }
            return {
              sha256: input.expectedSha256,
              receiptPath: `${input.path}.${method === 'copy-live-incoming' ? 'copied' : 'acknowledged'}`
            } as T
          }
          throw new Error(`Unexpected live-ingest smoke helper method: ${method}`)
        }
      }
      const transferPorts = { clock: systemTransferClock, paths: {
        backups: join(recoverySmokeRoot, 'backups'), receipts: join(recoverySmokeRoot, 'receipts')
      } }
      const firstIngestBatch = await syncLiveIncoming({ ...transferPorts, helper: incomingHelper, database: recoveryDatabase })
      const repeatedIngestBatch = await syncLiveIncoming({ ...transferPorts, helper: incomingHelper, database: recoveryDatabase })
      if (firstIngestBatch.ingested.length !== 2 || repeatedIngestBatch.ingested.length !== 0) {
        throw new Error('A repeated multi-item live ingest was not idempotent after durable commit.')
      }
      const restartedOperationId = randomUUID()
      const restartedQueue = queue(`${restartedOperationId}-0`, 'a')
      recoveryDatabase.prepareRetrievalOperation({
        operationId: restartedOperationId,
        stashPath: 'live://gdia/hc',
        sourceSha256: 'smoke-restarted-retrieval',
        startedAtUtc: new Date().toISOString(),
        vaultItemIds: [recoveryImport.importedIds[0]!],
        detail: {
          phase: 'queued',
          smokeTest: true,
          vaultItemIds: [recoveryImport.importedIds[0]!],
          queues: [restartedQueue]
        }
      })
      recoveryDatabase.markRetrievalNeedsRecovery(
        restartedOperationId,
        new Error('Simulated CC exit after queueing.')
      )
      let repeatedSubmitRejected = false
      try {
        recoveryDatabase.prepareRetrievalOperation({
          operationId: randomUUID(),
          stashPath: 'live://gdia/hc',
          sourceSha256: 'smoke-repeat-submit',
          startedAtUtc: new Date().toISOString(),
          vaultItemIds: [recoveryImport.importedIds[0]!],
          detail: { phase: 'prepared', smokeTest: true }
        })
      } catch {
        repeatedSubmitRejected = true
      }
      recoveryDatabase.close()
      recoveryDatabase = new CollectionDatabase(recoverySmokePath)
      if (
        !repeatedSubmitRejected ||
        recoveryDatabase.listRecoveryOperations()[0]?.id !== restartedOperationId
      ) {
        throw new Error('A queued retrieval did not survive restart or reject a repeated submit.')
      }

      const recoveryStatuses = new Map<string, LiveRetrievalStatus>([
        [restartedQueue.operationId, {
          state: 'deposited',
          receiptPath: join(recoverySmokeRoot, 'deleted', `${restartedQueue.operationId}.csv`)
        }]
      ])
      const recoveryHelper: HelperRequester = {
        request: async <T>(method: string, params: object = {}): Promise<T> => {
          const input = params as { queue?: LiveRetrievalQueue; path?: string; expectedSha256?: string }
          if (method === 'inspect-live-retrieval' && input.queue) {
            return (recoveryStatuses.get(input.queue.operationId) ?? {
              state: 'unknown', receiptPath: null
            }) as T
          }
          if ((method === 'copy-live-incoming' || method === 'ack-live-incoming') && input.path) {
            return {
              sha256: input.expectedSha256,
              receiptPath: `${input.path}.${method === 'copy-live-incoming' ? 'copied' : 'acknowledged'}`
            } as T
          }
          throw new Error(`Unexpected recovery smoke helper method: ${method}`)
        }
      }
      if (
        await reconcileLiveRecoveryOperations({ ...transferPorts, helper: recoveryHelper, database: recoveryDatabase, diagnostics }) !== 1 ||
        recoveryDatabase.getVaultItems([recoveryImport.importedIds[0]!], true)[0]?.state !== 'retrieved' ||
        recoveryDatabase.getRecoveryOperationCount() !== 0
      ) {
        throw new Error('A deposited retrieval did not reconcile after a simulated CC restart.')
      }

      const generatedOperationId = randomUUID()
      const generatedQueues = [
        queue(`${generatedOperationId}-0`, 'b'),
        queue(`${generatedOperationId}-1`, 'c')
      ]
      recoveryDatabase.prepareDeliveryOperation({
        operationId: generatedOperationId,
        destination: 'live://personal-inventory/augments',
        payloadSha256: 'smoke-generated-delivery',
        startedAtUtc: new Date().toISOString(),
        detail: {
          phase: 'queued',
          smokeTest: true,
          queues: generatedQueues,
          records: ['smoke-augment-a', 'smoke-augment-b'],
          isHardcore: true
        }
      })
      recoveryDatabase.markDeliveryNeedsRecovery(
        generatedOperationId,
        new Error('Simulated Grim Dawn exit during a multi-item delivery.')
      )
      recoveryStatuses.set(generatedQueues[0]!.operationId, {
        state: 'deposited',
        receiptPath: join(recoverySmokeRoot, 'deleted', `${generatedQueues[0]!.operationId}.csv`)
      })
      recoveryStatuses.set(generatedQueues[1]!.operationId, {
        state: 'rejected',
        receiptPath: join(recoverySmokeRoot, 'incoming', `${generatedQueues[1]!.operationId}.csv`)
      })
      if (
        await reconcileLiveRecoveryOperations({ ...transferPorts, helper: recoveryHelper, database: recoveryDatabase, diagnostics }) !== 1 ||
        !recoveryDatabase.hasCommittedOperation(generatedOperationId)
      ) {
        throw new Error('A partial multi-item supply delivery did not reconcile deterministically.')
      }

      const staleOperationId = randomUUID()
      const staleQueue = queue(`${staleOperationId}-0`, 'd')
      recoveryDatabase.prepareRetrievalOperation({
        operationId: staleOperationId,
        stashPath: 'live://gdia/hc',
        sourceSha256: 'smoke-stale-receipt',
        startedAtUtc: new Date().toISOString(),
        vaultItemIds: [recoveryImport.importedIds[1]!],
        detail: {
          phase: 'queued',
          smokeTest: true,
          vaultItemIds: [recoveryImport.importedIds[1]!],
          queues: [staleQueue]
        }
      })
      recoveryDatabase.markRetrievalNeedsRecovery(
        staleOperationId,
        new Error('Simulated stale receipt.')
      )
      recoveryStatuses.set(staleQueue.operationId, { state: 'unknown', receiptPath: null })
      if (
        await reconcileLiveRecoveryOperations({ ...transferPorts, helper: recoveryHelper, database: recoveryDatabase, diagnostics }) !== 0 ||
        recoveryDatabase.getRecoveryOperationCount() !== 1 ||
        recoveryDatabase.getVaultItems([recoveryImport.importedIds[1]!], true)[0]?.state !== 'retrieval_pending'
      ) {
        throw new Error('A stale or mismatched receipt did not remain fail-closed for audit.')
      }
      recoveryDatabase.failRetrievalOperation(
        staleOperationId,
        [recoveryImport.importedIds[1]!],
        new Error('Smoke cleanup after verified fail-closed stale receipt.')
      )
      if (recoveryDatabase.getDiagnosticSummary().quickCheck.some(
        (value) => value.toLocaleLowerCase() !== 'ok'
      )) {
        throw new Error('Recovery reconciliation damaged the archive database.')
      }
    } finally {
      recoveryDatabase?.close()
      await rm(recoverySmokeRoot, { recursive: true, force: true })
    }
    const recoveryOperationId = randomUUID()
    database.prepareRetrievalOperation({
      operationId: recoveryOperationId,
      stashPath: 'smoke-uncertain-outcome.gsh',
      sourceSha256: 'smoke-uncertain-outcome',
      startedAtUtc: new Date().toISOString(),
      vaultItemIds: [migration.importedIds[1]!],
      detail: { phase: 'prepared', smokeTest: true, scenario: 'helper_timeout' }
    })
    database.markRetrievalNeedsRecovery(recoveryOperationId, new Error('Simulated lost response.'))
    const databaseDiagnostics = database.getDiagnosticSummary()
    if (
      databaseDiagnostics.quickCheck.some((value) => value.toLocaleLowerCase() !== 'ok') ||
      database.getRecoveryOperationCount() !== 1 ||
      !databaseDiagnostics.recoveryOperations.some(
        (operation) => operation.id === recoveryOperationId && operation.state === 'needs_recovery'
      )
    ) {
      throw new Error('Uncertain transfer state was not retained for recovery diagnostics.')
    }
    console.log(
      JSON.stringify({
        helper: 'available',
        writeTransaction: 'verified',
        liveQueue: 'verified',
        migrationDedupe: 'verified',
        duplicateSelection: 'rejected',
        rejectedRetrievalRollback: 'verified',
        generatedDeliveryJournal: 'verified',
        uncertainOutcomeRecovery: 'verified',
        restartRecovery: 'verified',
        offlineReceiptRecovery: 'verified',
        staleReceipt: 'rejected',
        multiItemRecovery: 'verified',
        multiItemLiveIngest: 'verified',
        databaseIntegrity: 'verified',
        archiveBackupRestore: 'verified',
        archiveRollCache: 'verified',
        debugLoggingSetting: 'verified',
        serializerRoundTrips: roundTrips.length,
        ingestPlans: ingestPlans.length,
        retrievalRoundTrips: retrievalRoundTrips.length,
        retrievalJournal: 'verified',
        vaultListing: 'verified',
        vaultPaging: 'verified',
        analyzedCopies: analyzedCopies.length,
        trustedRolls: trustedRolls.length,
        withheldRolls: analyzedCopies.length - trustedRolls.length,
        pinnedBest: 'verified',
        installations: discovery.installations.length,
        saveLocations: discovery.saveLocations.length,
        transferStashes: stashCount,
        catalogItems: snapshot.items.length,
        collected,
        retainedDiscoveries
      })
    )
    helper.dispose()
    database.close()
    app.exit(0)
  } catch (error) {
    console.error(error)
    helper.dispose()
    database.close()
    app.exit(1)
  }
}
