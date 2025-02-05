import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  CommandInteraction,
  ComponentType,
  SelectMenuBuilder,
} from 'discord.js';
import addLati from '../../../economy/addLati';
import findUser from '../../../economy/findUser';
import removeItemsById from '../../../economy/removeItemsById';
import setStats from '../../../economy/stats/setStats';
import buttonHandler from '../../../embeds/buttonHandler';
import embedTemplate from '../../../embeds/embedTemplate';
import ephemeralReply from '../../../embeds/ephemeralReply';
import errorEmbed from '../../../embeds/errorEmbed';
import { displayAttributes } from '../../../embeds/helpers/displayAttributes';
import itemString, { itemStringCustom } from '../../../embeds/helpers/itemString';
import latiString from '../../../embeds/helpers/latiString';
import Item from '../../../interfaces/Item';
import UserProfile, { SpecialItemInProfile } from '../../../interfaces/UserProfile';
import itemList, { ItemKey } from '../../../items/itemList';
import { PIRKT_PARDOT_NODOKLIS } from './pardot';

function makeComponents(itemsInInv: SpecialItemInProfile[], itemObj: Item, selectedIds: string[]) {
  return [
    new ActionRowBuilder<SelectMenuBuilder>().addComponents(
      new SelectMenuBuilder()
        .setCustomId('pardot_special_select')
        .setPlaceholder('Izvēlies ko pārdot')
        .setMinValues(1)
        .setMaxValues(itemsInInv.length)
        .setOptions(
          itemsInInv
            .slice(0, 25)
            .sort((a, b) =>
              itemObj.customValue ? itemObj.customValue(b.attributes) - itemObj.customValue(a.attributes) : 0
            )
            .map(item => ({
              label: itemStringCustom(itemObj, item.attributes?.customName),
              description:
                `${latiString(itemObj.customValue ? itemObj.customValue(item.attributes) : itemObj.value)} | ` +
                displayAttributes(item, true),
              value: item._id!,
              emoji: itemObj.emoji || '❓',
              default: !!selectedIds.length && selectedIds!.includes(item._id!),
            }))
        )
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('pardot_special_confirm')
        .setDisabled(!selectedIds.length)
        .setLabel('Pārdot')
        .setStyle(selectedIds.length ? ButtonStyle.Primary : ButtonStyle.Secondary)
    ),
  ];
}

function makeEmbed(
  i: CommandInteraction,
  user: UserProfile,
  soldItems: SpecialItemInProfile[],
  soldValue: number,
  color: number
) {
  return embedTemplate({
    i,
    title: 'Tu pārdevi:',
    color,
    fields: [
      ...soldItems.map(item => ({
        name: itemString(itemList[item.name], null, false, item.attributes.customName),
        value: displayAttributes(item),
        inline: false,
      })),
      { name: 'Tu ieguvi', value: latiString(soldValue, true), inline: true },
      { name: 'Tev tagad ir', value: latiString(user.lati), inline: true },
    ],
  });
}

export default async function pardotRunSpecial(
  i: CommandInteraction,
  itemKey: ItemKey,
  itemsInInv: SpecialItemInProfile[],
  embedColor: number
) {
  const userId = i.user.id;
  const guildId = i.guildId!;

  const itemObj = itemList[itemKey];
  let selectedIds: string[] = [];

  if (itemsInInv.length === 1) {
    const soldValue = itemObj.customValue ? itemObj.customValue(itemsInInv[0].attributes) : itemObj.value;

    const taxPaid = Math.floor(soldValue * PIRKT_PARDOT_NODOKLIS);

    await Promise.all([
      addLati(i.client.user!.id, guildId, taxPaid),
      addLati(userId, guildId, soldValue),
      setStats(userId, guildId, { soldShop: soldValue, taxPaid }),
    ]);

    const user = await removeItemsById(userId, guildId, [itemsInInv[0]._id!]);
    if (!user) return i.reply(errorEmbed);

    return i.reply(makeEmbed(i, user, itemsInInv, soldValue, embedColor));
  }

  const msg = await i.reply(
    embedTemplate({
      i,
      color: embedColor,
      description:
        `Tavā inventārā ir **${itemString(itemObj, itemsInInv.length)}**\n` +
        `No saraksta izvēlies vienu vai vairākas mantas kuras pārdot`,
      components: makeComponents(itemsInInv, itemObj, selectedIds),
    })
  );

  await buttonHandler(
    i,
    'pardot',
    msg,
    async componentInteraction => {
      const { customId } = componentInteraction;
      if (customId === 'pardot_special_select') {
        if (componentInteraction.componentType !== ComponentType.StringSelect) return;
        selectedIds = componentInteraction.values;
        return {
          edit: {
            components: makeComponents(itemsInInv, itemObj, selectedIds),
          },
        };
      } else if (customId === 'pardot_special_confirm') {
        if (componentInteraction.componentType !== ComponentType.Button) return;
        const selectedItems = itemsInInv.filter(item => selectedIds.includes(item._id!));
        const soldValue = selectedItems.reduce((p, { attributes }) => {
          return p + (itemObj.customValue ? itemObj.customValue(attributes) : itemObj.value);
        }, 0);

        if (!selectedItems.length) return;

        const user = await findUser(userId, guildId);
        if (!user) return { error: true };

        const userItemIds = user.specialItems.map(item => item._id!);
        for (const id of selectedIds) {
          if (!userItemIds.includes(id)) {
            return {
              end: true,
              after: async () => {
                await componentInteraction.reply(
                  ephemeralReply(
                    '**Kļūda:** tavs inventāra saturs ir mainījies, kāda no izvēlētām mantām vairs nav tavā inventārā'
                  )
                );
              },
            };
          }
        }

        const taxPaid = Math.floor(soldValue * PIRKT_PARDOT_NODOKLIS);

        await Promise.all([
          addLati(i.client.user!.id, guildId, taxPaid),
          addLati(userId, guildId, soldValue),
          setStats(userId, guildId, { soldShop: soldValue, taxPaid }),
        ]);

        const userAfter = await removeItemsById(userId, guildId, selectedIds);
        if (!userAfter) return { error: true };

        return {
          edit: {
            embeds: makeEmbed(i, userAfter, selectedItems, soldValue, embedColor).embeds,
            components: [],
          },
        };
      }
    },
    60000
  );
}
