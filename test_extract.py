"""
测试知识抽取 - 为赵无用的记忆手动抽取实体和关系
"""

import json
from services.llm_service import LLMService
from services.graph_service import GraphService

# 文本内容
text = """我叫赵无用，这个名字是我爹在我出生那天取的。据说他抱着我站在卫生院门口，看着天上的乌云叹了口气说："这孩子这辈子怕是没什么用了。"于是，赵无用这三个字就跟着我走过了四十七年的人生。

我出生在1979年，地点是甘肃省一个叫柳树沟的地方。柳树沟其实没有柳树，就像我的人生其实没有多大用处一样，名字和现实之间总是隔着一层可笑的荒诞。我爹是柳树沟小学的民办教师，一个月拿二十八块钱工资，要养活我妈、我姐、我还有我奶奶五口人。我娘说怀我那会儿她连鸡蛋都吃不上，所以生下来我只有四斤八两，像只剥了皮的兔子。

我小时候的记忆基本都是关于饿的。不是那种现在人们说的"哎呀我好饿"的饿，是真正的、从胃里往外烧的那种饿。春天我们去挖荠菜，夏天去捋榆钱，秋天刨人家收过之后落在地里的土豆，冬天最难熬，白菜帮子煮一锅汤，一人一碗，喝完还是饿。我姐赵招弟比我大五岁，她总把她的馒头掰一半给我，自己喝汤。后来她十六岁就嫁人了，嫁到隔壁县一个杀猪的家里，临走那天她跟我说："无用，你得读书，读书才能不饿肚子。"

我确实读了书。我爹虽然给我取了个丧气的名字，但在读书这件事上他没含糊过。他把他那点可怜的工资掰成几瓣，给我买铅笔、买本子、买字典。那本《新华字典》我现在还留着，封面上用胶布缠了一圈又一圈，翻开来有股霉味，但每一个字我都认识。我爹说："无用，爹教不了你什么，但这本字典里的字，你要是都认识了，这世上就没有能困住你的东西了。"

他这话后来被证明是错的。我认识字典里所有的字，可困住我的东西还是太多了。

1997年我高考，考了全县第三名。那时候兴报志愿，我想报兰州大学，我爹说报师范吧，师范不要学费还管饭。我报了西北师范大学中文系，录取通知书寄到柳树沟那天，我爹拿着那张纸的手一直在抖，我娘哭了一整个下午。

大学四年，我过得像一只掉进米缸里的老鼠。我第一次知道原来人可以一天吃三顿饭，原来食堂里的馒头可以随便拿不限量，原来世界上还有一种东西叫"洗澡"——就是热水从头顶浇下来，不用烧水不用兑凉水，拧开就有。我用了整整一个学期才适应这种奢侈的生活，体重从九十二斤长到了一百一十八斤。

毕业后我分配到武威市的一所中学当语文老师。说实话我教得不怎么样，因为我总想在课堂上讲一些跟考试无关的东西，比如诗歌，比如哲学，比如人生的意义。校长找我谈话，说赵老师你讲这些没用，学生要的是分数。我说可是这些也是知识啊，校长说那能当饭吃吗？

我哑口无言。因为我比任何人都清楚，没有什么东西能当饭吃，除了饭本身。

2003年我结了婚，对象是隔壁学校的数学老师，姓王，叫王素芬。我们经人介绍认识的，见了三次面就把婚定了。她长得不算好看，但笑起来很干净，像春天的白水萝卜。结婚那天她跟我说："赵无用，你这名字真难听，以后在学校别人叫你赵老师还行，回家我叫你什么？"我说："你叫我无用就行，反正我这辈子确实没什么用。"她白了我一眼，说："那我就叫你老赵吧。"

我们生了一个女儿，取名叫赵有颜。我坚决没让我爹起名字，因为谁知道他会不会起个赵没脸之类的。赵有颜长得很像她妈，眼睛不大但很有神，从小嘴就利索，八个月就会叫爸爸，一岁半就能背整首《静夜思》。我抱着她的时候总在想，这个孩子以后千万不要像我，不要觉得自己无用，不要被生活捆住手脚。

可我没想到的是，最先被生活捆住的不是她，是我。

2010年，学校开始搞绩效工资改革，教龄、职称、课时量、考试成绩，全部量化打分，跟工资挂钩。我的职称一直是中级，上不去，因为我不够"积极"——不争优秀教师名额，不主动申请当班主任，不写教学论文发表在那些交版面费的垃圾期刊上。我的工资从两千八降到了两千四，而同期的同事有的已经拿到了四千多。王素芬没有抱怨，但她开始接更多的家教，每天晚上去学生家里补课，有时候九点多才回来。我们之间的话越来越少，像两条平行线，各过各的日子。

2015年发生了一件事，彻底改变了我的人生轨迹。那年暑假，我带着赵有颜去敦煌玩，在莫高窟的一个洞窟里，我站在一尊唐代彩塑面前，突然就哭了出来。那尊菩萨像微微低垂着眼睛，嘴角有一丝若有若无的笑意，历经一千多年，依然安静地站在那里，不言不语，不悲不喜。赵有颜吓坏了，拽着我的衣角问爸爸你怎么了。我说没事，爸爸只是觉得，这尊菩萨真好看。

回来之后我像变了一个人。我开始翻看关于敦煌的书籍，研究壁画里的故事，学着认那些变体字、异体字、古藏文、西夏文。我把所有的业余时间都花在了这上面，用我那点可怜的工资买书、买资料、买拓片。王素芬以为我疯了，她说你都三十好几的人了，折腾这些有什么用？我说我也不知道有什么用，但我就是想弄明白。

2018年，敦煌研究院招一个临时的文献整理员，没有编制，月薪三千五，管一顿午饭。我辞了学校的教职，去了。王素芬跟我大吵一架，她说赵无用你就是个无用的人，好好的铁饭碗不要，去干临时工，女儿上中学的费用你出得起吗？我无言以对，因为我确实出不起。赵有颜站在中间，看看她妈又看看我，最后说了一句："妈，让爸去吧，他这辈子就这点念想了。"

我在敦煌待了四年。那四年是我人生中最穷但也最富足的日子。白天整理文献，晚上就住在单位的一间小宿舍里，窗外就是戈壁滩，风大的时候能听到沙子打在玻璃上的声音。我学会了喝砖茶，学会了吃羊肉，学会了在四十度的高温下一动不动地抄写经文。我整理出了一份关于敦煌变文的索引，发在了一本学术期刊上，没有任何稿费，但我把那本期刊揣在怀里揣了整整一个月。

2020年疫情来了，敦煌研究院缩减经费，临时工全部裁撤。我又失业了，带着几箱子书和资料回到武威。王素芬没有说什么，她给我下了一碗面，卧了两个荷包蛋。我吃面的时候她坐在对面看着我，忽然说："老赵，你头发白了。"我说："早就有白头发了。"她说："不是，是比以前白了更多。"

那一年我四十一岁，一事无成，没有存款，没有房产，连一份正经工作都没有。我唯一的资产是那一屋子书和几千张手写的卡片，上面记满了关于敦煌的各种考证和笔记。我有时候会想，如果当初不辞职，我现在应该已经是高级教师了，工资至少五千，再过几年就能评特级，安安稳稳到退休，多好。但转念一想，那种好，是好到让人忘记自己还活着的好。

2021年，有出版社的人不知道从哪里看到了我那篇变文索引的文章，联系我说想出一本关于敦煌通俗文化的书。我花了八个月时间写出了初稿，又改了六遍，最后定稿那天是腊月二十三，小年。窗外有人放鞭炮，噼里啪啦的，赵有颜从房间跑出来说她闻到火药味了，要开窗透气。冷风灌进来，吹得桌上的稿纸哗哗响，我觉得那是这辈子最好听的声音。

书出版之后卖得一般，没成什么畅销书，但陆续有一些读者给我写信，说他们因为这本书去了敦煌，站在壁画前感动得说不出话来。我收到过一封来自云南的信，是一个初中生写的，字歪歪扭扭的，她说："赵老师，谢谢你让我知道，原来一千多年前的人也和我们一样，会害怕、会想家、会对着月亮哭。"我把那封信读了三遍，然后夹在我那本破旧的《新华字典》里。

现在，2026年，我四十七岁，在武威一家民营书店做店员，一个月两千八。书店老板是个年轻人，比我小二十岁，他说赵叔你就在这儿待着吧，想看书看书，想写东西写东西，不着急。我每天骑着那辆叮当响的自行车上下班，路上经过一片杨树林，秋天的时候落叶铺满一地，车轮碾过去发出细碎的声响。

王素芬还在教数学，赵有颜去年考上了兰州大学，学的考古。送她去学校那天，她拉着行李箱走了几步又回头跑过来抱住我，说："爸，你名字起得不对，你不是无用的人。"我说："你懂什么，老子叫无用，那是大用，你回去看看《庄子》就知道了。"

她笑着跑了，马尾辫在脑后晃来晃去，像一匹欢快的小马。

我站在兰州火车站广场上，阳光很好，风也正好。我想起我爹说过的话——认识了字典里所有的字，就没有能困住你的东西了。现在我明白了，困住我的从来不是不认识的字，而是那些认识却做不到的事。比如勇敢，比如坚持，比如在所有人都说你没用的时候，还觉得自己多少有点用。

不过这些都无所谓了。四十七年，一事无成，但也一事不欠。我姓赵，叫无用，甘肃柳树沟人，这辈子活得像一棵没人浇水的树，歪歪扭扭地长着，好歹也长了这么高。

就这样吧。"""

# 手动定义实体和关系（基于文本内容分析）
entities = [
    # 人物
    {"id": "zhao_wuyong", "name": "赵无用", "type": "PERSON", "description": "主人公，1979年生于甘肃柳树沟，四十七年人生经历坎坷但坚持自我"},
    {"id": "zhao_father", "name": "赵爹", "type": "PERSON", "description": "赵无用的父亲，柳树沟小学民办教师"},
    {"id": "zhao_mother", "name": "赵娘", "type": "PERSON", "description": "赵无用的母亲"},
    {"id": "zhao_zhaodi", "name": "赵招弟", "type": "PERSON", "description": "赵无用的姐姐，比赵无用大五岁，十六岁嫁人"},
    {"id": "wang_sufen", "name": "王素芬", "type": "PERSON", "description": "赵无用的妻子，数学老师"},
    {"id": "zhao_youyan", "name": "赵有颜", "type": "PERSON", "description": "赵无用的女儿，兰州大学考古系学生"},
    
    # 地点
    {"id": "liushugou", "name": "柳树沟", "type": "LOCATION", "description": "甘肃省的一个小村庄，赵无用的出生地"},
    {"id": "wuwei", "name": "武威市", "type": "LOCATION", "description": "赵无用工作生活的城市"},
    {"id": "dunhuang", "name": "敦煌", "type": "LOCATION", "description": "赵无用精神寄托之地，莫高窟所在地"},
    {"id": "mogao", "name": "莫高窟", "type": "LOCATION", "description": "敦煌石窟，赵无用研究的地方"},
    {"id": "lanzhou", "name": "兰州", "type": "LOCATION", "description": "甘肃省会，兰州大学所在地"},
    {"id": "lanzhou_univ", "name": "兰州大学", "type": "LOCATION", "description": "赵有颜就读的大学"},
    {"id": "northwest_normal", "name": "西北师范大学", "type": "LOCATION", "description": "赵无用的母校"},
    {"id": "dunhuang_institute", "name": "敦煌研究院", "type": "LOCATION", "description": "赵无用工作过四年的地方"},
    
    # 时间/事件
    {"id": "birth_1979", "name": "1979年出生", "type": "TIME", "description": "赵无用出生于1979年"},
    {"id": "gaokao_1997", "name": "1997年高考", "type": "EVENT", "description": "赵无用高考全县第三名，考入西北师范大学"},
    {"id": "marriage_2003", "name": "2003年结婚", "type": "EVENT", "description": "赵无用于2003年与王素芬结婚"},
    {"id": "dunhuang_trip_2015", "name": "2015年敦煌之行", "type": "EVENT", "description": "赵无用带女儿去敦煌，在莫高窟痛哭，人生转折点"},
    {"id": "dunhuang_work_2018", "name": "2018年敦煌工作", "type": "EVENT", "description": "赵无用辞去教职，去敦煌研究院做临时工"},
    {"id": "unemployment_2020", "name": "2020年失业", "type": "EVENT", "description": "疫情导致敦煌研究院裁员，赵无用失业"},
    {"id": "book_published_2021", "name": "2021年出书", "type": "EVENT", "description": "赵无用的敦煌通俗文化书籍出版"},
    {"id": "current_2026", "name": "2026年现状", "type": "TIME", "description": "赵无用四十七岁，在书店做店员"},
    
    # 物品
    {"id": "xinhua_dict", "name": "《新华字典》", "type": "OBJECT", "description": "赵无用父亲买的字典，陪伴赵无用一生"},
    {"id": "bike", "name": "自行车", "type": "OBJECT", "description": "赵无用上下班骑的叮当响的自行车"},
    {"id": " manuscripts", "name": "手稿", "type": "OBJECT", "description": "赵无用的敦煌研究笔记和卡片"},
    
    # 概念
    {"id": "persistence", "name": "坚持", "type": "CONCEPT", "description": "赵无用人生的核心主题"},
    {"id": "uselessness", "name": "无用", "type": "CONCEPT", "description": "赵无用名字的内涵，也是他的人生哲学"},
    {"id": "dunhuang_culture", "name": "敦煌文化", "type": "CONCEPT", "description": "赵无用的精神寄托和研究对象"},
    {"id": "hunger_memory", "name": "饥饿记忆", "type": "CONCEPT", "description": "赵无用童年关于饥饿的记忆"},
]

relations = [
    {"source": "zhao_wuyong", "target": "zhao_father", "type": "child_of", "description": "赵无用是赵爹的儿子"},
    {"source": "zhao_wuyong", "target": "zhao_mother", "type": "child_of", "description": "赵无用是赵娘的儿子"},
    {"source": "zhao_wuyong", "target": "zhao_zhaodi", "type": "sibling_of", "description": "赵招弟是赵无用的姐姐"},
    {"source": "zhao_wuyong", "target": "wang_sufen", "type": "married_to", "description": "赵无用与王素芬结婚"},
    {"source": "zhao_wuyong", "target": "zhao_youyan", "type": "parent_of", "description": "赵无用是赵有颜的父亲"},
    
    {"source": "zhao_wuyong", "target": "liushugou", "type": "born_in", "description": "赵无用出生于柳树沟"},
    {"source": "zhao_wuyong", "target": "wuwei", "type": "lived_in", "description": "赵无用在武威工作生活"},
    {"source": "zhao_wuyong", "target": "dunhuang", "type": "connected_to", "description": "敦煌是赵无用的精神寄托"},
    {"source": "zhao_wuyong", "target": "mogao", "type": "studied_at", "description": "赵无用研究莫高窟"},
    {"source": "zhao_youyan", "target": "lanzhou_univ", "type": "studies_at", "description": "赵有颜在兰州大学读书"},
    {"source": "zhao_wuyong", "target": "northwest_normal", "type": "graduated_from", "description": "赵无用毕业于西北师范大学"},
    {"source": "zhao_wuyong", "target": "dunhuang_institute", "type": "worked_at", "description": "赵无用在敦煌研究院工作"},
    
    {"source": "dunhuang_trip_2015", "target": "mogao", "type": "happened_at", "description": "敦煌之行发生在莫高窟"},
    {"source": "dunhuang_trip_2015", "target": "zhao_youyan", "type": "involved", "description": "赵有颜参与了敦煌之行"},
    {"source": "dunhuang_work_2018", "target": "dunhuang_institute", "type": "happened_at", "description": "赵无用在敦煌研究院工作"},
    
    {"source": "zhao_father", "target": "xinhua_dict", "type": "gifted", "description": "赵爹给赵无用买了《新华字典》"},
    {"source": "zhao_wuyong", "target": "xinhua_dict", "type": "owns", "description": "赵无用珍藏《新华字典》"},
    {"source": "zhao_wuyong", "target": "bike", "type": "uses", "description": "赵无用骑自行车上下班"},
    {"source": "zhao_wuyong", "target": "dunhuang_culture", "type": "researches", "description": "赵无用研究敦煌文化"},
    {"source": "zhao_wuyong", "target": "persistence", "type": "embodies", "description": "赵无用体现了坚持的精神"},
    {"source": "uselessness", "target": "zhao_wuyong", "type": "defines", "description": "无用定义了赵无用的人生哲学"},
]

# 更新图谱
graph_service = GraphService()
graph_service.update_graph(
    entities=entities,
    relations=relations,
    memory_id="c56e621e-74ce-4d9f-9eb3-a10df2c5482e"
)

# 更新记忆的实体和关系
from services.memory_service import MemoryService
memory_service = MemoryService()
memory = memory_service.get_memory("c56e621e-74ce-4d9f-9eb3-a10df2c5482e")
if memory:
    memory['entities'] = entities
    memory['relations'] = relations
    memory_service.save_memory(memory)

print("知识图谱更新完成！")
print(f"   - 实体数量: {len(entities)}")
print(f"   - 关系数量: {len(relations)}")
print("\n实体统计:")
from collections import Counter
type_counts = Counter([e['type'] for e in entities])
for t, c in type_counts.items():
    print(f"   {t}: {c}个")
